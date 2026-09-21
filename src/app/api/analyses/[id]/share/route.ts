import { makeShareSlug } from "@/lib/slug";
import { ensureShareSlug } from "@/server/db/repo";
import { notFound } from "@/server/errors";
import { getDeviceId, ok, withRouteParams } from "@/server/http";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * POST /api/analyses/:id/share —— 生成（或取回已有的）分享短链。
 *
 * 幂等：重复点同一个按钮不会刷出一堆短链，也不会让已经发出去的链接失效。
 * 只有这份记录的创建者（同一台设备）才能给它生成分享链接。
 */
export const POST = withRouteParams<Params>("analyses.share", async ({ params }) => {
  const deviceId = await getDeviceId();
  const slug = await ensureShareSlug(params.id, deviceId, makeShareSlug);
  if (!slug) throw notFound("这条记录不在了，没法生成分享链接。");
  return ok({ slug, path: `/s/${slug}` });
});
