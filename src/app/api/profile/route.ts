import { profileSchema } from "@/lib/validation/schemas";
import { getProfile, upsertProfile } from "@/server/db/repo";
import { getDeviceId, ok, withRoute } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 关系背景档案。
 *
 * 存在理由：同一个「你最好是」，在「刚在一起两周」和「在一起两年、昨天刚吵过架」里
 * 完全是两句话。把背景存下来，下次就不用重复填，判断也更准。
 * 仍然按设备隔离，第三方拿不到。
 */
export const GET = withRoute("profile.get", async () => {
  const deviceId = await getDeviceId();
  const profile = await getProfile(deviceId);
  return ok(
    profile ?? { herName: null, relation: null, extra: null, updatedAt: 0 },
  );
});

export const PUT = withRoute("profile.put", async ({ request }) => {
  const deviceId = await getDeviceId();
  const body: unknown = await request.json().catch(() => null);
  const input = profileSchema.parse(body ?? {});
  const profile = await upsertProfile(deviceId, input);
  return ok(profile);
});
