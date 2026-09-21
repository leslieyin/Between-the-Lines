/**
 * 分析编排 —— 代码负责流程，模型只负责判断。
 *
 * 流程：
 *   解析文本 → 挑出要翻牌的句子 → 分批送 Jev（每批 4 句、批间并行受控）
 *   → 拿到逐句危险等级后，再问一次「整段怎么看」
 *   → 汇总成一份快照交给上层落库
 *
 * 两个刻意的设计决定：
 *  1. **分批而不是一次一句**。整段对话随每个问题重复发给模型，但请求数从「句数」
 *     降到「句数 / 4」。在 Workers 的 CPU 预算和上游限流面前，这个差别是决定性的。
 *  2. **单批失败不拖垮整体**。某批重试耗尽仍然失败时，那几句标成「没算出来」，
 *     其余照常展示。宁可用户看到 12 句结论 + 4 句没算出来，也不要整页报错。
 */

import { chunk, mapLimit } from "@/lib/concurrency";
import { evaluate, type Answer } from "@/lib/typesafe/client";
import { getConfig } from "@/server/config";
import { invalidInput, upstreamUnavailable } from "@/server/errors";
import { createLogger } from "@/server/logger";
import { buildDemoConversation, buildDemoDangerLevels, buildDemoLineAnalysis } from "./demo";
import { asChoice, asNoul, asScore } from "./judgment";
import { parseConversation, selectFocusLines } from "./parse";
import {
  buildConversationQuestions,
  buildLineQuestions,
  buildState,
  CONVERSATION_KEYS,
  DANGER_LEVELS,
  FALLBACK_KEYS,
  LABELS,
  requiredLineKeys,
  TREND_LEVELS,
  withLineDanger,
  type AnalyzeState,
} from "./prompts";
import type {
  AnalysisInput,
  AnalysisRecord,
  AnalysisSnapshot,
  ConversationJudgment,
  Judgment,
  LineAnalysis,
  ParsedLine,
  ScoreJudgment,
  Speaker,
} from "./types";

const log = createLogger({ module: "analyze" });

/** 同时在飞的 Jev 请求上限。默认批大小 4、最多 16 句 → 4 批，正好在安全区间内。 */
const MAX_CONCURRENT_BATCHES = 3;

type Usage = { inputTokens: number; outputTokens: number; requests: number };

function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, requests: 0 };
}

function addUsage(target: Usage, usage: { input_tokens?: number; output_tokens?: number }): void {
  target.inputTokens += Number(usage.input_tokens ?? 0);
  target.outputTokens += Number(usage.output_tokens ?? 0);
  target.requests += 1;
}

/** AnalyzeState.chat 里的 who 字符串还原成 Speaker（存快照用） */
function whoToSpeaker(who: string): Speaker {
  if (who === "她") return "her";
  if (who === "我") return "me";
  return "unknown";
}

function toParsedLines(state: AnalyzeState): ParsedLine[] {
  return state.chat.map((c) => ({
    index: c.n,
    speaker: whoToSpeaker(c.who),
    label: c.who,
    text: c.text,
  }));
}

export async function runAnalysis(
  input: AnalysisInput,
  ctx: { requestId: string },
): Promise<AnalysisRecord> {
  const cfg = getConfig();
  const startedAt = Date.now();

  const parsed = parseConversation(input.raw, {
    herName: input.herName,
    youAre: input.youAre,
  });
  if (parsed.otherCount > 0) {
    log.info("analyze.third_party_lines_ignored", { count: parsed.otherCount });
  }

  if (parsed.herCount === 0) {
    // 两个真实昵称但没指认「哪个是你」时，这里给出可读的指引，而不是一句「没认出」
    const names = parsed.candidates.map((c) => c.label).filter((label) => label !== "");
    throw invalidInput(
      names.length >= 2
        ? `这段对话里出现了 ${names.map((n) => `「${n}」`).join("、")} 两个人。先在上面选一下哪个是你，我就算另一个人说的话。`
        : "没认出哪句是她说的。试试每行开头加上「她：」和「我：」，或者在上面把她的备注名填上。",
      { herCount: 0, candidates: names },
    );
  }

  const focus = selectFocusLines(parsed.lines, cfg.limits.maxAnalyzedLines);
  const state = buildState(
    { her_name: input.herName, relation: input.relation, background: input.extra },
    parsed.lines,
  );

  if (cfg.demoMode) {
    // 线上跑演示数据是「静默错误」里最坏的一种：界面一切正常，但那些数字不是算出来的。
    // 每次分析都留一条 WARN，让它在 Cloudflare 日志里显形 —— 密钥配在控制台的人尤其需要这个信号。
    log.warn("analyze.demo_mode_active", {
      hint: "本次返回的是内置样例，不是 Jev 算的。检查云端是否误设了 DEMO_MODE=true。",
    });
  }

  const snapshot = cfg.demoMode
    ? buildDemoSnapshot(focus, state)
    : await buildLiveSnapshot(focus, state, ctx);

  const peakDanger = snapshot.analyzed.reduce(
    (max, line) => (line.failed ? max : Math.max(max, line.danger.level)),
    0,
  );

  const record: AnalysisRecord = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    title: makeTitle(input, focus),
    shareSlug: null,
    input,
    snapshot,
    peakDanger,
    herLines: focus.length,
  };

  log.info("analyze.done", {
    herLines: focus.length,
    peakDanger,
    demo: snapshot.demo,
    requests: snapshot.usage.requests,
    elapsedMs: Date.now() - startedAt,
  });

  record.snapshot.usage.elapsedMs = Date.now() - startedAt;
  return record;
}

// ── 真实模式 ────────────────────────────────────────────────────────────────

async function buildLiveSnapshot(
  focus: ParsedLine[],
  state: AnalyzeState,
  ctx: { requestId: string },
): Promise<AnalysisSnapshot> {
  const cfg = getConfig();
  const usage = emptyUsage();

  const groups = chunk(focus, cfg.limits.groupSize);
  const groupResults = await mapLimit(groups, MAX_CONCURRENT_BATCHES, async (group) => {
    try {
      const evaluation = await evaluate(state, buildLineQuestions(group), { traceId: ctx.requestId });
      addUsage(usage, evaluation.usage);
      const answers = evaluation.answers as unknown as Record<string, Answer>;
      return group.map((line) => buildLineAnalysis(line, answers));
    } catch (error) {
      log.warn("analyze.batch_failed", {
        lines: group.map((l) => l.index),
        cause: error instanceof Error ? error.message : String(error),
      });
      return group.map((line) => failedLine(line));
    }
  });

  const analyzed = groupResults.flat().sort((a, b) => a.index - b.index);

  // 整段判断：带上刚算出来的逐句危险等级作为辅助数据，让「走势」有据可依
  const conversation = await analyzeConversation(
    withLineDanger(
      state,
      analyzed.filter((l) => !l.failed).map((l) => ({ n: l.index, danger: l.danger.level })),
    ),
    usage,
    ctx,
  );

  return {
    version: 1,
    lines: toParsedLines(state),
    analyzed,
    conversation,
    usage: { ...usage, elapsedMs: 0 },
    demo: false,
  };
}

function buildLineAnalysis(line: ParsedLine, answers: Record<string, Answer>): LineAnalysis {
  const required = requiredLineKeys(line);
  const missing = required.filter((entry) => answers[entry.key]?.type !== entry.type);
  if (missing.length > 0) {
    log.warn("analyze.incomplete_line", { line: line.index, missing: missing.map((m) => m.key) });
    return failedLine(line);
  }

  const key = `l${line.index}`;
  return {
    index: line.index,
    text: line.text,
    worthReading: asNoul(answers[`${key}_overtone`]),
    isIronic: asNoul(answers[`${key}_flip`]),
    intent: asChoice(answers[`${key}_intent`], LABELS.intent, FALLBACK_KEYS.intent),
    need: asChoice(answers[`${key}_need`], LABELS.need, FALLBACK_KEYS.need),
    danger: asScore(answers[`${key}_danger`], DANGER_LEVELS),
    move: asChoice(answers[`${key}_move`], LABELS.move, FALLBACK_KEYS.move),
  };
}

/**
 * 「没算出来」的占位。
 * 这里刻意不去凑一个看起来合理的中间值 —— 界面会明确显示「这段没算出来」，
 * 不能让人把一个占位数字当成结论。
 */
function failedLine(line: ParsedLine): LineAnalysis {
  return {
    index: line.index,
    text: line.text,
    failed: true,
    worthReading: 0.5,
    isIronic: 0.5,
    intent: neutralChoice(LABELS.intent, FALLBACK_KEYS.intent),
    need: neutralChoice(LABELS.need, FALLBACK_KEYS.need),
    danger: neutralScore(DANGER_LEVELS),
    move: neutralChoice(LABELS.move, FALLBACK_KEYS.move),
  };
}

function neutralChoice(labels: Record<string, string>, key: string): Judgment {
  return { key, label: labels[key] ?? key, probabilities: {}, confidence: 0 };
}

function neutralScore(levels: readonly string[]): ScoreJudgment {
  return { key: "1", label: levels[1] ?? "", probabilities: {}, confidence: 0, level: 1 };
}

async function analyzeConversation(
  conversationState: ReturnType<typeof withLineDanger>,
  usage: Usage,
  ctx: { requestId: string },
): Promise<ConversationJudgment> {
  const evaluation = await evaluate(conversationState, buildConversationQuestions(), {
    traceId: ctx.requestId,
  });
  addUsage(usage, evaluation.usage);

  const answers = evaluation.answers as unknown as Record<string, Answer>;
  const missing = CONVERSATION_KEYS.filter((key) => !answers[key]);
  if (missing.length > 0) {
    // 整段结论没有「部分可用」的中间态：拿不到就如实失败
    throw upstreamUnavailable({ reason: "incomplete_conversation_answers", missing });
  }

  return {
    verdict: asChoice(answers.verdict, LABELS.verdict, FALLBACK_KEYS.verdict),
    trend: asScore(answers.trend, TREND_LEVELS),
    priority: asChoice(answers.priority, LABELS.priority, FALLBACK_KEYS.priority),
  };
}

// ── 演示模式 ────────────────────────────────────────────────────────────────

function buildDemoSnapshot(focus: ParsedLine[], state: AnalyzeState): AnalysisSnapshot {
  const parsedLines = toParsedLines(state);
  // 她说的第几句 —— 演示场景按这个推进，而不是按原文行号
  const ordinalByIndex = new Map(
    parsedLines.filter((l) => l.speaker === "her").map((l, i) => [l.index, i]),
  );
  const ordinalOf = (index: number) => ordinalByIndex.get(index) ?? 0;

  const analyzed = focus.map((line) =>
    buildDemoLineAnalysis(parsedLines, line.index, ordinalOf(line.index)),
  );
  const conversation = buildDemoConversation(buildDemoDangerLevels(focus.map((l) => ordinalOf(l.index))));

  return {
    version: 1,
    lines: parsedLines,
    analyzed,
    conversation,
    usage: { inputTokens: 0, outputTokens: 0, requests: 0, elapsedMs: 0 },
    demo: true,
  };
}

// ── 杂项 ────────────────────────────────────────────────────────────────────

/** 历史列表里的标题：取第一句她的话截断。比「分析记录 #12」有用得多。 */
function makeTitle(input: AnalysisInput, focus: ParsedLine[]): string {
  const flat = (focus[0]?.text ?? "一段对话").replace(/\s+/g, " ").trim();
  const clipped = flat.length > 22 ? `${flat.slice(0, 22)}…` : flat;
  return `${input.herName?.trim() || "她"}：${clipped}`;
}
