/**
 * 集中配置：所有环境变量只在这一处读取、只在这一处校验。
 *
 * 设计原则（对应「配置全部来自环境变量并在启动时集中校验、快速失败」）：
 *  - 业务代码永远不直接读 process.env，只 import { getConfig }。
 *  - 缺失/非法的必填项立刻抛错，而不是等某个请求跑一半才崩。
 *  - 演示模式（DEMO_MODE=true）下允许缺少 API Key，让还没拿到额度的人也能跑通全链路。
 *
 * 取值来源按优先级合并两处：
 *  1. process.env —— 本地 `next dev` 时 Next.js 会自动加载 .env.local
 *  2. Cloudflare 绑定环境 —— 线上是 Workers 的 secrets / vars，本地是 wrangler 的 .dev.vars
 * 这样同一份代码在本地和线上都不用改。
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

export type AppConfig = {
  readonly typesafeApiKey: string | null;
  readonly model: string;
  readonly baseUrl: string;
  readonly demoMode: boolean;
  readonly limits: {
    readonly maxChars: number;
    readonly maxLines: number;
    readonly maxAnalyzedLines: number;
    readonly groupSize: number;
    readonly ratePerHour: number;
    readonly requestTimeoutMs: number;
  };
  readonly isProd: boolean;
};

/** 从 process.env 与 Cloudflare 绑定里合并取一个字符串。 */
function envValue(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess.trim() !== "") return fromProcess.trim();

  try {
    const { env } = getCloudflareContext();
    const value = (env as unknown as Record<string, unknown>)[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  } catch {
    // 不在请求上下文里（例如构建期），忽略
  }
  return undefined;
}

function readInt(name: string, fallback: number): number {
  const raw = envValue(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `配置项 ${name} 必须是正整数，当前值为 "${raw}"。请检查 .env.local（参考 .env.example）。`,
    );
  }
  return parsed;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = envValue(name);
  if (raw === undefined) return fallback;
  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`配置项 ${name} 必须是布尔值，当前值为 "${raw}"。`);
}

let cached: AppConfig | null = null;

/** 惰性单例：首次真正用到时再校验，避免 `next build` 阶段就被卡住。 */
export function getConfig(): AppConfig {
  if (cached !== null) return cached;

  const demoMode = readBool("DEMO_MODE", false);
  const apiKey = envValue("TYPESAFE_API_KEY") ?? "";

  if (!apiKey && !demoMode) {
    throw new Error(
      [
        "缺少 TYPESAFE_API_KEY。请在项目根目录创建 .env.local 并写入：",
        "  TYPESAFE_API_KEY=ts_live_...",
        "暂时没有 Key 的话，改成 DEMO_MODE=true 就能用内置样例跑通整个界面。",
      ].join("\n"),
    );
  }

  cached = {
    typesafeApiKey: apiKey || null,
    model: envValue("TYPESAFE_MODEL") ?? "jev-latest",
    baseUrl: (envValue("TYPESAFE_BASE_URL") ?? "https://api.typesafe.ai/v1").replace(/\/+$/, ""),
    demoMode,
    limits: {
      maxChars: readInt("ANALYZE_MAX_CHARS", 8000),
      maxLines: readInt("ANALYZE_MAX_LINES", 40),
      maxAnalyzedLines: readInt("ANALYZE_MAX_ANALYZED_LINES", 16),
      groupSize: readInt("ANALYZE_GROUP_SIZE", 4),
      ratePerHour: readInt("RATE_LIMIT_PER_HOUR", 20),
      requestTimeoutMs: readInt("TYPESAFE_TIMEOUT_MS", 60_000),
    },
    isProd: envValue("NODE_ENV") === "production",
  };
  return cached;
}

/** 仅供 /api/ready 使用：把配置校验结果转成探针输出，而不是让进程崩掉。 */
export function probeConfig():
  | { ok: true; demoMode: boolean; model: string }
  | { ok: false; error: string } {
  try {
    const cfg = getConfig();
    return { ok: true, demoMode: cfg.demoMode, model: cfg.model };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
