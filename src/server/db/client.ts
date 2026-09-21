/**
 * 数据库访问入口（Cloudflare D1）。
 *
 * 为什么用 D1：部署目标是 Cloudflare Workers，而 Workers 没有文件系统，
 * 本地 SQLite 文件在生产根本不存在。D1 是 CF 原生绑定，同一份代码在 `next dev`
 * （wrangler 提供的本地 SQLite 模拟）和线上完全一致，不需要维护两套 SQL。
 *
 * 表结构由 ensureSchema() 在首次访问时幂等创建：这样「一键部署」之后直接可用，
 * 不需要用户额外跑迁移命令。代价是每个 isolate 冷启动多 5 条 DDL —— D1 上是毫秒级，可接受。
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AppError } from "../errors";
import { createLogger } from "../logger";
import type { D1Database, D1Value } from "./d1-types";

const log = createLogger({ module: "db" });

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS analyses (
     id           TEXT PRIMARY KEY,
     device_id    TEXT NOT NULL,
     share_slug   TEXT UNIQUE,
     relation     TEXT,
     her_name     TEXT,
     title        TEXT NOT NULL,
     her_lines    INTEGER NOT NULL,
     peak_danger  REAL NOT NULL DEFAULT 0,
     payload      TEXT NOT NULL,
     created_at   INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_analyses_device ON analyses (device_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS profiles (
     device_id  TEXT PRIMARY KEY,
     her_name   TEXT,
     relation   TEXT,
     extra      TEXT,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS rate_events (
     id         TEXT PRIMARY KEY,
     device_id  TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_rate_events ON rate_events (device_id, created_at DESC)`,
];

let cached: D1Database | null = null;
let schemaReady = false;

/** 取 D1 绑定。绑定缺失时报一条清楚的内部错误，而不是让 undefined 冒泡成 500 堆栈。 */
export async function db(): Promise<D1Database> {
  if (cached) return cached;
  const { env } = await getCloudflareContext({ async: true });
  const binding = (env as unknown as Record<string, unknown>).DB;
  if (!binding) {
    throw new AppError("INTERNAL", 500, "数据库没接上，请联系站点维护者。", {
      context: { reason: "missing_d1_binding", hint: "wrangler.jsonc 里的 d1_databases 绑定名必须是 DB" },
    });
  }
  cached = binding as D1Database;
  return cached;
}

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const instance = await db();
  await instance.batch(SCHEMA.map((sql) => instance.prepare(sql)));
  schemaReady = true;
  log.info("db.schema_ready", { statements: SCHEMA.length });
}

/** 查询多行。集中在这里，业务层拿到的永远是干净的对象数组。 */
export async function queryAll<T>(sql: string, args: D1Value[] = []): Promise<T[]> {
  await ensureSchema();
  const instance = await db();
  const result = await instance.prepare(sql).bind(...args).all<T>();
  return result.results ?? [];
}

export async function queryFirst<T>(sql: string, args: D1Value[] = []): Promise<T | null> {
  await ensureSchema();
  const instance = await db();
  return (await instance.prepare(sql).bind(...args).first<T>()) ?? null;
}

export async function execute(sql: string, args: D1Value[] = []): Promise<number> {
  await ensureSchema();
  const instance = await db();
  const result = await instance.prepare(sql).bind(...args).run();
  return result.meta?.changes ?? 0;
}

/** 一个事务里跑多条写语句（用于「写计数 + 清理旧计数」这类成对操作）。 */
export async function executeBatch(statements: { sql: string; args?: D1Value[] }[]): Promise<void> {
  await ensureSchema();
  const instance = await db();
  await instance.batch(
    statements.map((s) => instance.prepare(s.sql).bind(...(s.args ?? []))),
  );
}
