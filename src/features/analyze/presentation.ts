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
  /**
   * 白底长图专用色（hex），供 canvas 使用。
   * 不能直接用 `color`：canvas 遇到 `var(...)` 会整句忽略、沿用上一个 fillStyle，
   * 结果就是长图里所有颜色悄悄变成灰的；而且深色主题的亮色放到白底上也看不清。
   */
  shot: string;
};

export const DANGER_META: DangerMeta[] = [
  { short: "随口一问", full: DANGER_LEVELS[0], color: "var(--color-danger-0)", shot: "#3f9e78" },
  { short: "有点情绪", full: DANGER_LEVELS[1], color: "var(--color-danger-1)", shot: "#a8802f" },
  { short: "明显不满", full: DANGER_LEVELS[2], color: "var(--color-danger-2)", shot: "#c96a2a" },
  { short: "高危", full: DANGER_LEVELS[3], color: "var(--color-danger-3)", shot: "#c93f3b" },
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
  { short: "在变好", full: TREND_LEVELS[0], color: "var(--color-danger-0)", shot: "#3f9e78" },
  { short: "略好转", full: TREND_LEVELS[1], color: "var(--color-danger-0)", shot: "#3f9e78" },
  { short: "平着走", full: TREND_LEVELS[2], color: "var(--color-danger-1)", shot: "#a8802f" },
  { short: "在变紧", full: TREND_LEVELS[3], color: "var(--color-danger-2)", shot: "#c96a2a" },
  { short: "在恶化", full: TREND_LEVELS[4], color: "var(--color-danger-3)", shot: "#c93f3b" },
];

export function trendMeta(level: number): DangerMeta {
  return TREND_META[Math.max(0, Math.min(TREND_META.length - 1, level))]!;
}

export function trendLabel(level: number): string {
  return TREND_LEVELS[Math.max(0, Math.min(TREND_LEVELS.length - 1, level))] ?? "";
}

/**
 * 情绪类型（她真正想说的）的色标。
 *
 * 这是第三个维度，和「危险等级」刻意分开：情绪类型回答的是「她这是什么情绪」，
 * 危险等级回答的是「这句有多危险」。同一个情绪（比如「在试探你」）可以是随口一问也可以是高危，
 * 用同一套色阶会让人把「她在试探」直接读成「这句很危险」，那是错读。
 *
 * `page` 给深色页面用，`shot` 给白底长图用（canvas 不认 var()，且白底要压暗一档才看得清）。
 */
const EMOTION_COLOR: Record<string, { page: string; shot: string }> = {
  expressing_dissatisfaction: { page: "#e0794a", shot: "#c9542f" }, // 在表达不满
  testing: { page: "#b98cd9", shot: "#7d5ba6" }, // 在试探你
  wanting_comfort: { page: "#e58aa8", shot: "#c2567c" }, // 想要被哄
  seeking_reassurance: { page: "#7aa9e0", shot: "#3f7bbf" }, // 想确认你还在乎她
  asking_for_action: { page: "#6fc2a8", shot: "#2f8f74" }, // 想要你去做
  setting_boundary: { page: "#c9c3d8", shot: "#5a5468" }, // 在划底线
  smalltalk: { page: "#8f8aa3", shot: "#8a8a8a" }, // 随口聊
  unclear: { page: "#7a7390", shot: "#9a9a9a" }, // 信息不够，说不准
};

export function emotionColor(key: string): { page: string; shot: string } {
  return EMOTION_COLOR[key] ?? EMOTION_COLOR.unclear!;
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
