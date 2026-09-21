/**
 * 把 Jev 的原始答案收敛成界面能直接用的 Judgment。
 *
 * 这里做三件事：
 *  1. 类型收窄 —— 按 `type` 字段确认拿到的确实是 Noul / Choice / Score。
 *  2. 数值清洗 —— 概率只保留 0..1，并过滤出选项表里真实存在的 key。
 *     模型偶尔会把选项名拼错或者多给一个不存在的 key，直接扔给界面会渲染出空行。
 *  3. 诚实兜底 —— 拿不到就返回「不确定」那一档，绝不编一个看起来笃定的结论。
 */

import { levelOf, topKey, type Answer } from "@/lib/typesafe/client";
import type { Judgment } from "./types";

function clamp01(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/** Noul：取 yes 概率。缺失时回到 0.5（等于「完全不确定」，而不是「大概率不是」）。 */
export function asNoul(answer: Answer | undefined, fallback = 0.5): number {
  if (answer && answer.type === "noul") return clamp01(answer.noul, fallback);
  return fallback;
}

/** 只保留落在允许集合里的概率项，并归一化，避免脏数据污染界面上的宽度条。 */
function sanitizeProbabilities(raw: unknown, allowed: Set<string>): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  let total = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) continue;
    out[key] = n;
    total += n;
  }
  if (total <= 0) return out;
  for (const key of Object.keys(out)) out[key] = (out[key]! / total);
  return out;
}

export function asChoice(
  answer: Answer | undefined,
  labels: Record<string, string>,
  fallbackKey: string,
): Judgment {
  const allowed = new Set(Object.keys(labels));
  if (!answer || answer.type !== "choice") return neutral(fallbackKey, labels);

  const probabilities = sanitizeProbabilities(answer.probabilities, allowed);
  const rawChoice = typeof answer.choice === "string" ? answer.choice : "";
  // choice 必须自己也在概率表里，否则说明模型前后矛盾，改用概率最高的那项
  const key = probabilities[rawChoice] !== undefined ? rawChoice : topKey(probabilities, fallbackKey);
  const label = labels[key] ?? labels[fallbackKey] ?? key;

  return {
    key,
    label,
    probabilities,
    confidence: clamp01(answer.confidence, 0),
  };
}

export function asScore(
  answer: Answer | undefined,
  levels: readonly string[],
): Judgment & { level: number } {
  if (!answer || answer.type !== "score") return neutralScore(levels);

  const allowed = new Set(levels.map((_, i) => String(i)));
  const probabilities = sanitizeProbabilities(answer.probabilities, allowed);
  const score = Number(answer.score);
  const level = levelOf(Number.isFinite(score) ? score : 0, levels.length);

  return {
    key: String(level),
    label: levels[level] ?? "",
    probabilities,
    confidence: clamp01(answer.confidence, 0),
    level,
  };
}

function neutral(key: string, labels: Record<string, string>): Judgment {
  return { key, label: labels[key] ?? key, probabilities: {}, confidence: 0 };
}

function neutralScore(levels: readonly string[]): Judgment & { level: number } {
  const level = Math.floor((levels.length - 1) / 2);
  return { key: String(level), label: levels[level] ?? "", probabilities: {}, confidence: 0, level };
}

/** 一句话总结：置信度低于阈值时，界面上应该显示「说不准」而不是把概率最高的当结论。 */
export function isConfident(judgment: Judgment, threshold = 0.4): boolean {
  return judgment.confidence >= threshold;
}
