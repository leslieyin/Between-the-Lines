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
import { AppError, isAppError } from "./errors";

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

/**
 * 取一个环境变量。**Cloudflare 运行时绑定优先，process.env 兜底。**
 *
 * 顺序不能反过来 —— 这是踩出来的：`next build` 会把构建当时 process.env 里的值
 * **快照进服务端 bundle**（`.env.local` 里非 NEXT_PUBLIC_ 的变量也会被带进去）。
 * 如果优先读 process.env，那么在本机跑过一次构建之后，`.env.local` 里的
 * `DEMO_MODE=true` 会一路渗进线上：控制台里明明配好了 Key，线上却在返回演示数据，
 * 而且界面上完全看不出异常。
 *
 * 反过来就没有这个问题：
 *  - 线上以 Worker 的 vars / secret 为权威，构建期的快照值覆盖不到它；
 *  - 本机开发用 `.dev.vars`（wrangler 约定），同样经绑定读到，
 *    而 `.dev.vars` 不会被 next build 快照，所以也不存在渗漏。
 */
function envValue(name: string): string | undefined {
  try {
    const { env } = getCloudflareContext();
    const value = (env as unknown as Record<string, unknown>)[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  } catch {
    // 不在请求上下文里（例如构建期、或纯 Node 脚本），忽略
  }

  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess.trim() !== "") return fromProcess.trim();

  return undefined;
}

function readInt(name: string, fallback: number): number {
  const raw = envValue(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(
      "CONFIG_MISSING",
      503,
      `配置项 ${name} 必须是正整数，当前是 "${raw}"。本地改 .dev.vars，线上改 wrangler.jsonc 的 vars 或控制台变量。`,
      { context: { key: name } },
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
  throw new AppError(
    "CONFIG_MISSING",
    503,
    `配置项 ${name} 必须是布尔值，当前是 "${raw}"。本地改 .dev.vars，线上改 wrangler.jsonc 的 vars 或控制台变量。`,
    { context: { key: name } },
  );
}

let cached: AppConfig | null = null;

/** 惰性单例：首次真正用到时再校验，避免 `next build` 阶段就被卡住。 */
export function getConfig(): AppConfig {
  if (cached !== null) return cached;

  const demoMode = readBool("DEMO_MODE", false);
  const apiKey = envValue("TYPESAFE_API_KEY") ?? "";

  // 快速失败：既没有 Key 又没开演示模式，立刻抛出一个**能直接展示给用户**的错误，
  // 而不是让每个请求都在半路崩成 500。文案分环境，因为两种环境的正确做法完全不同。
  if (!apiKey && !demoMode) {
    const runningOnWorkers =
      typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

    throw new AppError(
      "CONFIG_MISSING",
      503,
      runningOnWorkers
        ? "这个站点还没配置模型密钥。去 Cloudflare 控制台 → Workers → 你的 Worker → Settings → Variables and Secrets → Runtime variables and secrets，添加 TYPESAFE_API_KEY（类型选 Secret）。改完即生效，不需要重新部署。"
        : "还没配置模型密钥。把 .dev.vars.example 复制成 .dev.vars 并填上 TYPESAFE_API_KEY；暂时没有 Key 的话，在 .dev.vars 里加上 DEMO_MODE=true 就能用内置样例跑通整个界面。",
      {
        internalMessage: "TYPESAFE_API_KEY is not set and DEMO_MODE is off",
        context: { runningOnWorkers, demoMode },
      },
    );
  }

  cached = {
    typesafeApiKey: apiKey || null,
    model: envValue("TYPESAFE_MODEL") ?? "jev-latest",
    baseUrl: (envValue("TYPESAFE_BASE_URL") ?? "https://api.typesafe.ai/v1").replace(/\/+$/, ""),
    demoMode,
    limits: {
      maxChars: readInt("ANALYZE_MAX_CHARS", 8000),
      maxLines: readInt("ANALYZE_MAX_LINES", 100),
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
    // 注意取的是 userMessage 而不是 error.message：
    // AppError 把 message 留给了内部诊断信息（英文、含变量名），那是给日志看的，
    // 而 /api/ready 是公开端点，返回内部文案既读不懂也没必要暴露。
    if (isAppError(error)) return { ok: false, error: error.userMessage };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
