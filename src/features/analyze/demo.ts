/**
 * 演示模式：不调用 Jev，用确定性规则产出结果。
 *
 * 两个用途：
 *  1. 还没拿到 API Key 的人也能看到完整界面与交互，先判断这东西值不值得做。
 *  2. 前端开发时省额度 —— 不用为了调一个卡片间距去烧 16 次模型调用。
 *
 * 输出**刻意不伪装成真模型推理**：所有结果都会被打上 demo 标记，界面顶部会明确提示。
 * 这是条底线：一个用来解读人际关系的工具，绝不能让人以为随机数是结论。
 */

import { DANGER_LEVELS, LABELS, TREND_LEVELS } from "./prompts";
import type { Judgment, LineAnalysis, ParsedLine, ScoreJudgment } from "./types";

type Pattern = {
  overtone: number;
  flip: number;
  intent: [string, number];
  need: [string, number];
  danger: number;
  move: [string, number];
};

/**
 * 五个典型场景，按「她说话的顺序」循环套用：试探 → 施压 → 警告 → 追问 → 收尾。
 * 之所以按序号而不是按语义，是因为演示模式的唯一目标是把界面填满得真实可信，
 * 它不承担任何判断责任。
 */
const PATTERNS: Pattern[] = [
  {
    overtone: 0.93,
    flip: 0.34,
    intent: ["testing", 0.52],
    need: ["be_seen", 0.4],
    danger: 2,
    move: ["name_feeling", 0.45],
  },
  {
    overtone: 0.78,
    flip: 0.16,
    intent: ["testing", 0.6],
    need: ["reassurance", 0.35],
    danger: 1,
    move: ["act_concretely", 0.5],
  },
  {
    overtone: 0.96,
    flip: 0.74,
    intent: ["expressing_dissatisfaction", 0.48],
    need: ["action_now", 0.45],
    danger: 3,
    move: ["act_concretely", 0.42],
  },
  {
    overtone: 0.9,
    flip: 0.21,
    intent: ["asking_for_action", 0.55],
    need: ["action_now", 0.6],
    danger: 2,
    move: ["act_concretely", 0.6],
  },
  {
    overtone: 0.6,
    flip: 0.26,
    intent: ["smalltalk", 0.35],
    need: ["nothing", 0.35],
    danger: 0,
    move: ["act_concretely", 0.55],
  },
];

/**
 * 生成一个「一个选项独大、其余概率摊开」的分布。
 * 比随便填几个随机数更接近 Jev 的真实输出形态，界面上的概率条看起来才对。
 */
function distribution(winner: string, winnerProbability: number, others: string[]): Record<string, number> {
  const rest = others.filter((key) => key !== winner);
  const remaining = Math.max(0, 1 - winnerProbability);
  const each = rest.length > 0 ? remaining / rest.length : 0;
  return { [winner]: winnerProbability, ...Object.fromEntries(rest.map((k) => [k, each])) };
}

function demoChoice(
  labels: Record<string, string>,
  pick: [string, number],
  fallbackKey: string,
): Judgment {
  const keys = Object.keys(labels);
  const winner = keys.includes(pick[0]) ? pick[0] : fallbackKey;
  // 演示模式刻意让首选选项「明显领先」：真实 Jev 的输出通常有一个清晰的头名，
  // 铺得太平会到处触发「几项都说得通」的提示，反而不像真实结果。
  const winnerProbability = Math.max(0.56, Math.min(0.72, pick[1]));
  const probabilities = distribution(winner, winnerProbability, keys);
  return {
    key: winner,
    label: labels[winner] ?? winner,
    probabilities,
    // 置信度就用首选概率本身，保持和 Choice 的语义一致
    confidence: winnerProbability,
  };
}

function demoScore(
  levels: readonly string[],
  level: number,
): Judgment & { level: number } {
  const clamped = Math.max(0, Math.min(levels.length - 1, level));
  const probabilities: Record<string, number> = {};
  levels.forEach((_, i) => {
    probabilities[String(i)] = i === clamped ? 0.82 : 0.18 / Math.max(1, levels.length - 1);
  });
  return {
    key: String(clamped),
    label: levels[clamped] ?? "",
    probabilities,
    confidence: 0.82,
    level: clamped,
  };
}

/**
 * 生成某一句的演示结果。
 *
 * `ordinal` 是她说话的**顺序**（第几句），不是原文行号 —— 场景必须按「她说的第几句」推进，
 * 否则行号一错位，最重的「你最好是。」会被套上「随口一问」，整个演示就不可信了。
 */
export function buildDemoLineAnalysis(
  lines: ParsedLine[],
  index: number,
  ordinal: number,
): LineAnalysis {
  const line = lines.find((l) => l.index === index);
  const pattern = PATTERNS[ordinal % PATTERNS.length]!;
  return {
    index,
    text: line?.text ?? "",
    worthReading: pattern.overtone,
    isIronic: pattern.flip,
    intent: demoChoice(LABELS.intent, pattern.intent, "unclear"),
    need: demoChoice(LABELS.need, pattern.need, "nothing"),
    danger: demoScore(DANGER_LEVELS, pattern.danger),
    move: demoChoice(LABELS.move, pattern.move, "keep_chatting"),
  };
}

/** 逐句危险等级，同样按「她说的第几句」取场景。 */
export function buildDemoDangerLevels(ordinals: number[]): number[] {
  return ordinals.map((ordinal) => PATTERNS[ordinal % PATTERNS.length]!.danger);
}

/** 整段结论：由逐句危险等级的峰值与尾部走势推出来，保证和上面每张卡片自洽。 */
export function buildDemoConversation(
  dangerLevels: number[],
): {
  verdict: Judgment;
  trend: ScoreJudgment;
  priority: Judgment;
} {
  const peak = dangerLevels.length > 0 ? Math.max(...dangerLevels) : 0;
  const last = dangerLevels.length > 0 ? dangerLevels[dangerLevels.length - 1]! : 0;
  const first = dangerLevels.length > 0 ? dangerLevels[0]! : 0;

  const verdictKey =
    peak >= 3 ? "needs_repair" : peak >= 2 ? "needs_attention" : peak >= 1 ? "needs_attention" : "fine";
  const trendLevel = last < first ? 1 : last > first + 1 ? 4 : last > first ? 3 : 2;
  const priorityKey = peak >= 2 ? "make_a_plan" : "nothing_major";

  return {
    verdict: demoChoice(LABELS.verdict, [verdictKey, 0.5], "needs_attention"),
    trend: demoScore(TREND_LEVELS, trendLevel),
    priority: demoChoice(LABELS.priority, [priorityKey, 0.45], "nothing_major"),
  };
}
