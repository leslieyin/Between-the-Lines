/**
 * TypeSafe / Jev 类型化客户端。
 *
 * 为什么自己写而不是装 SDK：接口只有一个端点、三种问题类型，用 fetch 封一层大约 100 行，
 * 换来零依赖、可精确控制超时与重试策略，以及**编译期**就能对齐问题与答案的类型。
 *
 * 关键约束：这个模块只在服务端被 import。API Key 从 config 读取，永远不进客户端产物。
 */

import { getConfig } from "@/server/config";
import { AppError, timeout, upstreamAuth, upstreamUnavailable } from "@/server/errors";
import { createLogger } from "@/server/logger";

const log = createLogger({ module: "typesafe" });

// ── 问题类型 ────────────────────────────────────────────────────────────────

/** instructions / criteria 的取值：字符串，或结构化对象/数组（用于携带上下文数据） */
export type Payload = string | Record<string, unknown> | unknown[];

export type NoulQuestion = {
  type: "noul";
  instructions: Payload;
  criteria?: { true?: Payload; false?: Payload };
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: Payload;
  /** 选项 → 该选项的判定说明；不需要额外说明时写 null */
  criteria: Record<string, Payload | null>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: Payload;
  /** 有序等级描述，至少 2 级、最多 10 级 */
  criteria: Payload[];
};

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

// ── 答案类型 ────────────────────────────────────────────────────────────────

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** 根据问题声明推导出答案类型 —— 问 Choice 就一定会拿到 probabilities，问 Noul 就一定会拿到 noul。 */
type AnswerFor<Q> = Q extends { type: "noul" }
  ? NoulAnswer
  : Q extends { type: "choice" }
    ? ChoiceAnswer
    : Q extends { type: "score" }
      ? ScoreAnswer
      : never;

export type AnswersFor<T extends Record<string, Question>> = { [K in keyof T]: AnswerFor<T[K]> };

export type Evaluation<T extends Record<string, Question>> = {
  model: string;
  answers: AnswersFor<T>;
  usage: { input_tokens: number; output_tokens: number };
};

// ── 调用 ────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 指数退避 + 抖动；如果服务端给了 Retry-After 就听服务端的。 */
function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  const header = Number(retryAfterHeader);
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 15_000);
  const base = 500 * 2 ** attempt;
  return Math.min(base + Math.random() * 250, 8_000);
}

/**
 * 评估一次：把 state 交给 Jev，问一组问题，拿回一组答案。
 * 同一个请求里的问题互相看不到对方的答案，因此可以放心把独立问题一起发。
 */
export async function evaluate<T extends Record<string, Question>>(
  state: unknown,
  questions: T,
  options: { traceId?: string } = {},
): Promise<Evaluation<T>> {
  const cfg = getConfig();
  if (!cfg.typesafeApiKey) {
    throw new AppError("UPSTREAM_AUTH", 502, "服务端未配置模型密钥。", {
      context: { reason: "missing_api_key" },
    });
  }

  const url = `${cfg.baseUrl}/systemone`;
  const body = JSON.stringify({ state, model: cfg.model, questions });

  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.limits.requestTimeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.typesafeApiKey}`,
          "Content-Type": "application/json",
          ...(options.traceId ? { "x-request-id": options.traceId } : {}),
        },
        body,
        signal: controller.signal,
        cache: "no-store",
      });

      if (response.ok) {
        const parsed = (await response.json()) as Evaluation<T>;
        log.debug("typesafe.ok", {
          ms: Date.now() - startedAt,
          attempt,
          inputTokens: parsed.usage?.input_tokens,
          outputTokens: parsed.usage?.output_tokens,
        });
        return parsed;
      }

      const retryAfter = response.headers.get("retry-after");
      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
        const wait = backoffMs(attempt, retryAfter);
        log.warn("typesafe.retry", { status: response.status, attempt, waitMs: Math.round(wait) });
        await sleep(wait);
        continue;
      }

      // 密钥/额度问题单独归类，让用户看到「不是你的问题」
      if (response.status === 401 || response.status === 403) {
        throw upstreamAuth({ status: response.status, traceId: options.traceId });
      }
      if (response.status === 422) {
        const detail = await safeText(response);
        throw new AppError("BAD_REQUEST", 500, "内部请求格式有误，这不该发生，请联系维护者。", {
          context: { status: 422, detail: detail.slice(0, 300) },
        });
      }
      throw upstreamUnavailable({ status: response.status, traceId: options.traceId });
    } catch (error) {
      if (error instanceof AppError) throw error;

      const aborted = error instanceof Error && error.name === "AbortError";
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1) {
        const wait = backoffMs(attempt, null);
        log.warn("typesafe.network_retry", {
          attempt,
          waitMs: Math.round(wait),
          aborted,
        });
        await sleep(wait);
        continue;
      }
      if (aborted) throw timeout({ traceId: options.traceId, timeoutMs: cfg.limits.requestTimeoutMs });
      throw upstreamUnavailable({
        traceId: options.traceId,
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  throw upstreamUnavailable({
    traceId: options.traceId,
    cause: lastError instanceof Error ? lastError.message : "exhausted retries",
  });
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

// ── 小工具：把答案收敛成领域对象 ─────────────────────────────────────────────

/** 从概率分布里取 top-1，用于给 Choice 结果补一个稳定的 key。 */
export function topKey(probabilities: Record<string, number>, fallback: string): string {
  let best = fallback;
  let bestValue = -1;
  for (const [key, value] of Object.entries(probabilities)) {
    if (value > bestValue) {
      bestValue = value;
      best = key;
    }
  }
  return best;
}

/** 把 Score 的加权得分（可能落在两级之间）取整成最接近的等级下标。 */
export function levelOf(score: number, levelCount: number): number {
  const rounded = Math.round(score);
  return Math.max(0, Math.min(levelCount - 1, rounded));
}
