/**
 * 结构化 JSON 日志。
 *
 * 规则：
 *  - 每行一条 JSON，便于接 Vercel / Cloudflare / 任意日志平台。
 *  - 全链路带 requestId，方便把一个请求的多条日志串起来。
 *  - 绝不记录聊天内容、API Key、Cookie 原文（对应「不记录密码、令牌与隐私数据」）。
 *    需要排查时只记长度、条数、耗时这类元数据。
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const minLevel: Level =
  process.env.LOG_LEVEL === "debug" || process.env.LOG_LEVEL === "warn" || process.env.LOG_LEVEL === "error"
    ? process.env.LOG_LEVEL
    : "info";

/** 这些字段名一旦出现在 fields 里会被替换成 [redacted]，防止手滑把敏感信息写进日志。 */
const SENSITIVE_KEYS =
  /(key|token|secret|password|authorization|cookie|apikey|api_key|content|text|raw|message|chat)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return `[array:${value.length}]`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export type Logger = {
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
};

function emit(level: Level, bindings: Record<string, unknown>, event: string, fields?: Record<string, unknown>) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(redact(bindings) as Record<string, unknown>),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return {
    debug: (event, fields) => emit("debug", bindings, event, fields),
    info: (event, fields) => emit("info", bindings, event, fields),
    warn: (event, fields) => emit("warn", bindings, event, fields),
    error: (event, fields) => emit("error", bindings, event, fields),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger({ app: "huawaiyin" });
