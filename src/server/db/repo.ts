/**
 * 仓储层：唯一碰 SQL 的地方。
 *
 * 服务层只调用这里的函数，不知道 SQL 长什么样。
 * 所有查询都按 device_id 过滤 —— 历史记录天然只属于创建它的那台设备。
 *
 * 注意：D1 的 bind 不接受 undefined，所有可空字段统一转成 null。
 */

import type {
  AnalysisInput,
  AnalysisRecord,
  AnalysisSnapshot,
  AnalysisSummary,
  RelationshipProfile,
} from "@/features/analyze/types";
import { execute, executeBatch, queryAll, queryFirst } from "./client";
import type { D1Value } from "./d1-types";

type AnalysisRow = {
  id: string;
  device_id: string;
  share_slug: string | null;
  relation: string | null;
  her_name: string | null;
  title: string;
  her_lines: number;
  peak_danger: number;
  payload: string;
  created_at: number;
};

type SummaryRow = {
  id: string;
  created_at: number;
  title: string;
  her_name: string | null;
  relation: string | null;
  her_lines: number;
  peak_danger: number;
  share_slug: string | null;
};

type CountRow = { n: number };

type StoredPayload = { input: AnalysisInput; snapshot: AnalysisSnapshot };

function toRecord(row: AnalysisRow): AnalysisRecord {
  const payload = JSON.parse(row.payload) as StoredPayload;
  return {
    id: row.id,
    createdAt: Number(row.created_at),
    title: row.title,
    shareSlug: row.share_slug ?? null,
    input: payload.input,
    snapshot: payload.snapshot,
    peakDanger: Number(row.peak_danger),
    herLines: Number(row.her_lines),
  };
}

function toSummary(row: SummaryRow): AnalysisSummary {
  return {
    id: row.id,
    createdAt: Number(row.created_at),
    title: row.title,
    herName: row.her_name ?? null,
    relation: row.relation ?? null,
    herLines: Number(row.her_lines),
    peakDanger: Number(row.peak_danger),
    shareSlug: row.share_slug ?? null,
  };
}

export async function insertAnalysis(record: AnalysisRecord & { deviceId: string }): Promise<void> {
  const args: D1Value[] = [
    record.id,
    record.deviceId,
    record.shareSlug,
    record.input.relation,
    record.input.herName,
    record.title,
    record.herLines,
    record.peakDanger,
    JSON.stringify({ input: record.input, snapshot: record.snapshot }),
    record.createdAt,
  ];
  await execute(
    `INSERT INTO analyses
       (id, device_id, share_slug, relation, her_name, title, her_lines, peak_danger, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args,
  );
}

export async function listAnalyses(deviceId: string, limit = 50): Promise<AnalysisSummary[]> {
  const rows = await queryAll<SummaryRow>(
    `SELECT id, created_at, title, her_name, relation, her_lines, peak_danger, share_slug
       FROM analyses WHERE device_id = ? ORDER BY created_at DESC LIMIT ?`,
    [deviceId, limit],
  );
  return rows.map(toSummary);
}

export async function getAnalysis(id: string, deviceId: string): Promise<AnalysisRecord | null> {
  const row = await queryFirst<AnalysisRow>(
    `SELECT * FROM analyses WHERE id = ? AND device_id = ? LIMIT 1`,
    [id, deviceId],
  );
  return row ? toRecord(row) : null;
}

/** 分享页专用：公开可读，所以这里**不**按 device_id 过滤，靠不可猜的 slug 保护。 */
export async function getByShareSlug(slug: string): Promise<AnalysisRecord | null> {
  const row = await queryFirst<AnalysisRow>(`SELECT * FROM analyses WHERE share_slug = ? LIMIT 1`, [
    slug,
  ]);
  return row ? toRecord(row) : null;
}

/** 幂等：同一份分析重复点「生成分享链接」返回同一个 slug，不会刷出一堆短链。 */
export async function ensureShareSlug(
  id: string,
  deviceId: string,
  makeSlug: () => string,
): Promise<string | null> {
  const row = await queryFirst<{ share_slug: string | null }>(
    `SELECT share_slug FROM analyses WHERE id = ? AND device_id = ? LIMIT 1`,
    [id, deviceId],
  );
  if (!row) return null;
  if (row.share_slug) return row.share_slug;

  const slug = makeSlug();
  await execute(`UPDATE analyses SET share_slug = ? WHERE id = ? AND device_id = ?`, [
    slug,
    id,
    deviceId,
  ]);
  return slug;
}

export async function deleteAnalysis(id: string, deviceId: string): Promise<boolean> {
  const changed = await execute(`DELETE FROM analyses WHERE id = ? AND device_id = ?`, [
    id,
    deviceId,
  ]);
  return changed > 0;
}

/** 「一键清空」——真删，不做软删除。用户点清空就是要它消失。 */
export async function deleteAllAnalyses(deviceId: string): Promise<number> {
  return execute(`DELETE FROM analyses WHERE device_id = ?`, [deviceId]);
}

export async function getProfile(deviceId: string): Promise<RelationshipProfile | null> {
  const row = await queryFirst<{
    her_name: string | null;
    relation: string | null;
    extra: string | null;
    updated_at: number;
  }>(`SELECT her_name, relation, extra, updated_at FROM profiles WHERE device_id = ? LIMIT 1`, [
    deviceId,
  ]);
  if (!row) return null;
  return {
    herName: row.her_name ?? null,
    relation: row.relation ?? null,
    extra: row.extra ?? null,
    updatedAt: Number(row.updated_at),
  };
}

export async function upsertProfile(
  deviceId: string,
  profile: Pick<RelationshipProfile, "herName" | "relation" | "extra">,
): Promise<RelationshipProfile> {
  const updatedAt = Date.now();
  await execute(
    `INSERT INTO profiles (device_id, her_name, relation, extra, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       her_name = excluded.her_name,
       relation = excluded.relation,
       extra = excluded.extra,
       updated_at = excluded.updated_at`,
    [deviceId, profile.herName, profile.relation, profile.extra, updatedAt],
  );
  return { ...profile, updatedAt };
}

/** 限流用：统计窗口内该设备已经发起的分析次数。 */
export async function countAnalysesSince(deviceId: string, sinceMs: number): Promise<number> {
  const row = await queryFirst<CountRow>(
    `SELECT COUNT(*) AS n FROM rate_events WHERE device_id = ? AND created_at >= ?`,
    [deviceId, sinceMs],
  );
  return Number(row?.n ?? 0);
}

export async function recordAnalysisAttempt(deviceId: string): Promise<void> {
  await executeBatch([
    {
      sql: `INSERT INTO rate_events (id, device_id, created_at) VALUES (?, ?, ?)`,
      args: [crypto.randomUUID(), deviceId, Date.now()],
    },
    // 顺手清掉 24 小时前的计数，避免这张表无限增长
    { sql: `DELETE FROM rate_events WHERE created_at < ?`, args: [Date.now() - 24 * 60 * 60 * 1000] },
  ]);
}
