/**
 * HTTP 层公共设施：统一响应结构、全局错误处理、请求 ID、设备标识。
 *
 * 三个约定：
 *  1. 成功一律 { ok: true, data }，失败一律 { ok: false, error: { code, message } }。
 *  2. 任何未捕获异常都在这里兜底，绝不让堆栈漏到响应体里。
 *  3. requestId 用 header 透传（x-request-id），前端出问题时报这个 ID 就能定位。
 */

import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, invalidInput } from "./errors";
import { createLogger } from "./logger";

export const DEVICE_COOKIE = "hw_did";
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: { code: string; message: string; requestId: string } };

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true as const, data }, init);
}

export function fail(error: unknown, requestId: string): NextResponse<ApiFailure> {
  const log = createLogger({ requestId });

  if (error instanceof ZodError) {
    const appErr = invalidInput("输入内容不符合要求，请检查后重试。", {
      issues: error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
    });
    log.warn("request.invalid_input", { code: appErr.code, context: appErr.context });
    return NextResponse.json(
      { ok: false as const, error: { code: appErr.code, message: appErr.userMessage, requestId } },
      { status: appErr.status },
    );
  }

  if (error instanceof AppError) {
    const level = error.status >= 500 ? "error" : "warn";
    log[level]("request.failed", {
      code: error.code,
      status: error.status,
      context: error.context,
      cause: error.cause instanceof Error ? error.cause.message : undefined,
    });
    return NextResponse.json(
      { ok: false as const, error: { code: error.code, message: error.userMessage, requestId } },
      {
        status: error.status,
        headers: error.code === "RATE_LIMITED"
          ? { "Retry-After": String(Number(error.context?.retryAfterSeconds ?? 60)) }
          : undefined,
      },
    );
  }

  log.error("request.unhandled", {
    cause: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json(
    {
      ok: false as const,
      error: { code: "INTERNAL", message: "服务出了点问题，稍后再试一次。", requestId },
    },
    { status: 500 },
  );
}

export type RouteContext = {
  requestId: string;
  log: ReturnType<typeof createLogger>;
  request: Request;
};

/**
 * 把 handler 包起来：注入 requestId、接管错误、记录耗时。
 *
 * 刻意拆成两个包装器而不是一个带可选第二参数的 —— Next.js 15 会为每个路由生成精确的签名
 * 校验（`.next/types`），动态路由的第二个参数必须**恰好**是 `{ params: Promise<{ id: string }> }`，
 * 可选参数或宽泛的 Record 都过不了。与其在类型上绕，不如让两种路由各用各的，签名天然对得上。
 */
export function withRoute(name: string, handler: (ctx: RouteContext) => Promise<NextResponse>) {
  return async (request: Request): Promise<NextResponse> =>
    guard(name, request, (requestId, log) => handler({ requestId, log, request }));
}

/** 动态路由（/api/analyses/[id] 这类）：`P` 写成 `{ id: string }`，与生成类型逐字对齐。 */
export function withRouteParams<P extends Record<string, string>>(
  name: string,
  handler: (ctx: RouteContext & { params: P }) => Promise<NextResponse>,
) {
  return async (request: Request, segment: { params: Promise<P> }): Promise<NextResponse> => {
    const params = await segment.params;
    return guard(name, request, (requestId, log) =>
      handler({ requestId, log, request, params }),
    );
  };
}

/** 共用的错误接管与耗时记录。 */
async function guard(
  name: string,
  request: Request,
  run: (requestId: string, log: ReturnType<typeof createLogger>) => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id")?.slice(0, 64) || crypto.randomUUID();
  const log = createLogger({ requestId, route: name });
  const startedAt = Date.now();
  try {
    const response = await run(requestId, log);
    response.headers.set("x-request-id", requestId);
    log.info("request.done", { status: response.status, ms: Date.now() - startedAt });
    return response;
  } catch (error) {
    const response = fail(error, requestId);
    response.headers.set("x-request-id", requestId);
    return response;
  }
}

/**
 * 读取（必要时下发）设备标识。
 *
 * 用它做「历史记录只看得到本机」「限流按设备算」。这是匿名标识，不含任何个人信息；
 * 用户清空历史时我们会顺手换一个新值，等于彻底断开旧数据的归属。
 * 刻意用 httpOnly，前端 JS 读不到，也不能被第三方脚本偷走。
 */
export async function getDeviceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(DEVICE_COOKIE)?.value;
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) return existing;
  return crypto.randomUUID();
}

/** 需要在新会话里写回 cookie 时使用（route handler 返回前 set 一次）。 */
export function attachDeviceCookie(response: NextResponse, deviceId: string): NextResponse {
  response.cookies.set({
    name: DEVICE_COOKIE,
    value: deviceId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  });
  return response;
}

/** 粗略的客户端 IP，仅用于限流的第二道闸（第一道是设备 cookie）。 */
export function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
