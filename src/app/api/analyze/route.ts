import { runAnalysis } from "@/features/analyze/service";
import { analyzeInputSchema } from "@/lib/validation/schemas";
import { getConfig } from "@/server/config";
import { insertAnalysis } from "@/server/db/repo";
import { invalidInput } from "@/server/errors";
import { attachDeviceCookie, getClientIp, getDeviceId, ok, withRoute } from "@/server/http";
import { consumeAnalysisQuota } from "@/server/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/analyze —— 一次完整的「翻牌」。
 *
 * 顺序刻意是：校验 → 限流 → 分析 → 落库 → 下发设备 cookie。
 * 限流放在分析之前，避免脚本用超大输入白烧模型额度。
 */
export const POST = withRoute("analyze", async ({ request, requestId, log }) => {
  const deviceId = await getDeviceId();
  const body: unknown = await request.json().catch(() => null);
  const input = analyzeInputSchema.parse(body);

  const cfg = getConfig();
  if (input.raw.length > cfg.limits.maxChars) {
    throw invalidInput(
      `这段太长了（${input.raw.length} 个字）。一次最多处理 ${cfg.limits.maxChars} 个字，先只贴最要紧的那一段。`,
    );
  }
  const lineCount = input.raw.split(/\r?\n/).filter((l) => l.trim() !== "").length;
  if (lineCount > cfg.limits.maxLines) {
    throw invalidInput(
      `行数太多了（${lineCount} 行）。一次最多 ${cfg.limits.maxLines} 行，拆成两段分别看会更准。`,
    );
  }
  if (lineCount < 1) {
    throw invalidInput("没读到内容，确认一下是不是没粘贴上。");
  }

  await consumeAnalysisQuota(deviceId, getClientIp(request));

  log.info("analyze.start", { chars: input.raw.length, lines: lineCount });
  const record = await runAnalysis(input, { requestId });
  await insertAnalysis({ ...record, deviceId });

  return attachDeviceCookie(ok(record), deviceId);
});
