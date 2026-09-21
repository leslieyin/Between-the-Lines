import { ok, withRoute } from "@/server/http";
import { sweepRateLimitState } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 存活探针：进程还在、能响应就够了。不碰数据库，避免把依赖抖动误判成服务挂了。 */
export const GET = withRoute("health", async () => {
  sweepRateLimitState();
  return ok({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime?.() ?? 0),
    now: Date.now(),
  });
});
