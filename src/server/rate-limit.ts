/**
 * 限流。
 *
 * 用「数据库里的滑动窗口计数」而不是内存计数器：Vercel / Cloudflare 这类环境每次请求
 * 可能落在不同实例上，内存计数等于没限。代价是一次额外查询，相对一次 Jev 调用可以忽略。
 *
 * 两道闸：
 *  1. 设备维度（httpOnly cookie）—— 正常用户撞不到，脚本刷会被拦住。
 *  2. IP 维度 —— 对付「清 cookie 重来」的简单绕过。
 */

import { getConfig } from "./config";
import { rateLimited } from "./errors";
import { countAnalysesSince, recordAnalysisAttempt } from "./db/repo";

const WINDOW_MS = 60 * 60 * 1000;
/** IP 维度的匿名标识：不存原始 IP，只存哈希前缀，够用且不算收集个人信息 */
const ipAttempts = new Map<string, number[]>();

function usedInMemoryIpWindow(key: string): number {
  const now = Date.now();
  const list = (ipAttempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  ipAttempts.set(key, list);
  return list.length;
}

/**
 * 通过则记录一次消耗；不通过直接抛 RATE_LIMITED（交给全局错误处理器变成 429 + Retry-After）。
 * 注意调用顺序：先检查、后记录，所以第 N+1 次才会被拒。
 */
export async function consumeAnalysisQuota(deviceId: string, ipKey: string): Promise<void> {
  const { limits } = getConfig();

  const perDevice = await countAnalysesSince(deviceId, Date.now() - WINDOW_MS);
  if (perDevice >= limits.ratePerHour) {
    // 滑动窗口下最坏情况要等满一小时，给个保守值即可
    throw rateLimited(300);
  }

  // IP 闸放宽到设备闸的 3 倍，避免同一 WiFi 下多人互相误伤
  const ipLimit = limits.ratePerHour * 3;
  if (usedInMemoryIpWindow(ipKey) >= ipLimit) {
    throw rateLimited(60);
  }

  await recordAnalysisAttempt(deviceId);
  const list = ipAttempts.get(ipKey) ?? [];
  list.push(Date.now());
  ipAttempts.set(ipKey, list);
}

/** 清理长期不活跃的 IP 桶，防止内存里堆垃圾（由 /api/health 顺带调用）。 */
export function sweepRateLimitState(): void {
  const now = Date.now();
  for (const [key, list] of ipAttempts) {
    const alive = list.filter((t) => now - t < WINDOW_MS);
    if (alive.length === 0) ipAttempts.delete(key);
    else ipAttempts.set(key, alive);
  }
}
