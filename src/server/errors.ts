/**
 * 类型化错误体系。
 *
 * 每个错误自带 HTTP 状态码与一个稳定的 `code`，客户端只看到规范化结构，
 * 永远拿不到堆栈或内部细节（对应「绝不返回堆栈或内部细节」）。
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "CONFIG_MISSING"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_AUTH"
  | "TIMEOUT"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** 可以直接展示给用户的中文提示（面向产品的文案，不是给工程师看的） */
  readonly userMessage: string;
  /** 仅在服务端日志里出现的补充上下文，不会返回给客户端 */
  readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    status: number,
    userMessage: string,
    options?: { cause?: unknown; context?: Record<string, unknown>; internalMessage?: string },
  ) {
    super(options?.internalMessage ?? userMessage, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.userMessage = userMessage;
    this.context = options?.context;
  }
}

export const badRequest = (userMessage: string, context?: Record<string, unknown>) =>
  new AppError("BAD_REQUEST", 400, userMessage, { context });

export const invalidInput = (userMessage: string, context?: Record<string, unknown>) =>
  new AppError("INVALID_INPUT", 422, userMessage, { context });

export const notFound = (userMessage = "找不到这条记录。") =>
  new AppError("NOT_FOUND", 404, userMessage);

export const rateLimited = (retryAfterSeconds: number) =>
  new AppError(
    "RATE_LIMITED",
    429,
    `算得太快了，休息一下再试。大约 ${retryAfterSeconds} 秒后恢复。`,
    { context: { retryAfterSeconds } },
  );

/** 上游（TypeSafe）侧的问题——不是我们的 bug，但要如实告诉用户「不是你的问题」 */
export const upstreamAuth = (context?: Record<string, unknown>) =>
  new AppError(
    "UPSTREAM_AUTH",
    502,
    "模型服务拒绝了这次请求（多半是 API Key 失效或额度用尽）。这不是你的问题，请联系站点维护者。",
    { context },
  );

export const upstreamUnavailable = (context?: Record<string, unknown>) =>
  new AppError(
    "UPSTREAM_UNAVAILABLE",
    503,
    "模型服务暂时连不上，稍后再点一次就好。",
    { context },
  );

export const timeout = (context?: Record<string, unknown>) =>
  new AppError("TIMEOUT", 504, "算得有点久，超时了。把记录拆短一点会更快。", { context });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
