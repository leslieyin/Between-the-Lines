import { deleteAnalysis, getAnalysis } from "@/server/db/repo";
import { notFound } from "@/server/errors";
import { getDeviceId, ok, withRouteParams } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/** GET /api/analyses/:id —— 取回一份完整快照（历史页点开某条时用） */
export const GET = withRouteParams<Params>("analyses.get", async ({ params }) => {
  const deviceId = await getDeviceId();
  const record = await getAnalysis(params.id, deviceId);
  if (!record) throw notFound("这条记录不在了，可能已经被清空。");
  return ok(record);
});

/** DELETE /api/analyses/:id —— 删掉这一条（连同它的分享链接一起失效） */
export const DELETE = withRouteParams<Params>("analyses.delete", async ({ params }) => {
  const deviceId = await getDeviceId();
  const removed = await deleteAnalysis(params.id, deviceId);
  if (!removed) throw notFound("这条记录不在了，可能已经被删掉。");
  return ok({ removed: true });
});
