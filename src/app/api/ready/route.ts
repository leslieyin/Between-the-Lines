import { probeConfig } from "@/server/config";
import { db } from "@/server/db/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 就绪探针：确认「配置齐了、数据库通了」。
 *
 * 和 /api/health 分开是有意的 —— 部署后第一次 502 时，你需要一眼看出到底是配置没传上去，
 * 还是 D1 绑定没接上。所以这里把两项检查的结果分开返回，而不是笼统地给一个 ok。
 */
export async function GET() {
  const config = probeConfig();

  let database: { ok: boolean; error?: string } = { ok: false };
  try {
    const instance = await db();
    await instance.prepare("SELECT 1 AS ok").first();
    database = { ok: true };
  } catch (error) {
    database = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const ready = config.ok && database.ok;
  return NextResponse.json(
    {
      ok: ready,
      data: {
        ready,
        config: config.ok
          ? { configured: true, demoMode: config.demoMode, model: config.model }
          : { configured: false, error: config.error },
        database,
      },
    },
    { status: ready ? 200 : 503 },
  );
}
