/**
 * 展示层的映射表与文案生成。
 *
 * 集中放在这里的原因：危险等级的颜色、文案、分享配文这三样东西必须彼此一致。
 * 一旦散落在各个组件里，改一次配色就会出现「卡片上是橙色、配文里写高危」这种错位。
 */

import { DANGER_LEVELS, TREND_LEVELS } from "./prompts";
import type { AnalysisRecord, LineAnalysis, ParsedLine } from "./types";

export type DangerMeta = {
  short: string;
  full: string;
  /** CSS 变量名，组件里通过 var(...) 使用 */
  color: string;
};

export const DANGER_META: DangerMeta[] = [
  { short: "随口一问", full: DANGER_LEVELS[0], color: "var(--color-danger-0)" },
  { short: "有点情绪", full: DANGER_LEVELS[1], color: "var(--color-danger-1)" },
  { short: "明显不满", full: DANGER_LEVELS[2], color: "var(--color-danger-2)" },
  { short: "高危", full: DANGER_LEVELS[3], color: "var(--color-danger-3)" },
];

export function dangerMeta(level: number): DangerMeta {
  return DANGER_META[Math.max(0, Math.min(DANGER_META.length - 1, level))]!;
}

/**
 * 走势是 5 级、危险是 4 级，刻意分开。
 * 走势问的是「方向」，危险问的是「当前有多糟」—— 用同一套色阶会让人把「在变好但底子很坏」
 * 误读成「情况不错」。所以走势的颜色只表达方向，第一格永远是安全的青绿。
 */
export const TREND_META: DangerMeta[] = [
  { short: "在变好", full: TREND_LEVELS[0], color: "var(--color-danger-0)" },
  { short: "略好转", full: TREND_LEVELS[1], color: "var(--color-danger-0)" },
  { short: "平着走", full: TREND_LEVELS[2], color: "var(--color-danger-1)" },
  { short: "在变紧", full: TREND_LEVELS[3], color: "var(--color-danger-2)" },
  { short: "在恶化", full: TREND_LEVELS[4], color: "var(--color-danger-3)" },
];

export function trendMeta(level: number): DangerMeta {
  return TREND_META[Math.max(0, Math.min(TREND_META.length - 1, level))]!;
}

export function trendLabel(level: number): string {
  return TREND_LEVELS[Math.max(0, Math.min(TREND_LEVELS.length - 1, level))] ?? "";
}

/** 置信度低的时候，界面上要明说「说不准」，而不是把概率最高的当结论端出去。 */
export function confidenceNote(confidence: number): string | null {
  if (confidence >= 0.55) return null;
  if (confidence <= 0) return "这项没算出稳定结果";
  return "几项都说得通，别当成笃定结论";
}

/** 把概率分布按高低排好，供「看全部可能」展开 */
export function rankedProbabilities(
  probabilities: Record<string, number>,
  labels: Record<string, string>,
): { key: string; label: string; value: number }[] {
  return Object.entries(probabilities)
    .map(([key, value]) => ({ key, label: labels[key] ?? key, value }))
    .sort((a, b) => b.value - a.value);
}

/** 「她说的第几句」——按全部行里的顺序数，而不是按被分析句子的序号数，和原文对得上。 */
export function ordinalInTranscript(lines: ParsedLine[], index: number): number {
  return lines.filter((l) => l.index <= index && l.speaker === "her").length;
}

export function worstLine(analyzed: LineAnalysis[]): LineAnalysis | null {
  let worst: LineAnalysis | null = null;
  for (const line of analyzed) {
    if (line.failed) continue;
    if (!worst || line.danger.level > worst.danger.level) worst = line;
  }
  return worst;
}

/**
 * 分享配文。
 * 面向「发给朋友问一句『是不是这个理』」的场景，所以只带最有信息量的一句，
 * 不留分析结论 —— 结论要让人点进来自己看，这才会有人点。
 */
export function buildShareCaption(record: AnalysisRecord): string {
  const worst = worstLine(record.snapshot.analyzed);
  const who = record.input.herName?.trim() || "对方";
  const head = `我把跟${who}的聊天记录喂给 AI 了。`;

  if (!worst) {
    return `${head}${record.herLines} 句话逐个翻牌，每一句都算了一遍真实意图。`;
  }

  const quote = worst.text.replace(/\s+/g, " ").trim().slice(0, 26);
  const meta = dangerMeta(worst.danger.level);
  return [
    head,
    `最危险的一句「${quote}」，算出来是「${meta.short}」——${meta.full}。`,
    `它觉得她其实${worst.intent.label}，需要的是${worst.need.label}。`,
    "你们看看是不是这个理。",
  ].join("");
}
