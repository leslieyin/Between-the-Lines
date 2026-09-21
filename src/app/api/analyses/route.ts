import { listQuerySchema } from "@/lib/validation/schemas";
import { deleteAllAnalyses, listAnalyses } from "@/server/db/repo";
import { attachDeviceCookie, getDeviceId, ok, withRoute } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/analyses —— 本设备的历史记录（永远只看得到自己这台设备的） */
export const GET = withRoute("analyses.list", async ({ request }) => {
  const deviceId = await getDeviceId();
  const url = new URL(request.url);
  const { limit } = listQuerySchema.parse({
    limit: url.searchParams.get("limit") ?? undefined,
  });
  const items = await listAnalyses(deviceId, limit ?? 50);
  return ok({ items });
});

/**
 * DELETE /api/analyses —— 一键清空本设备的全部历史。
 *
 * 顺带换一个新的设备标识：这样旧数据不只是从列表里消失，而是彻底和当前浏览器断开归属。
 * 用户点「清空」的语义就是「当我没来过」，不该在数据库里留下一条能对回去的线索。
 */
export const DELETE = withRoute("analyses.clear", async () => {
  const deviceId = await getDeviceId();
  const removed = await deleteAllAnalyses(deviceId);
  const fresh = crypto.randomUUID();
  return attachDeviceCookie(ok({ removed }), fresh);
});
