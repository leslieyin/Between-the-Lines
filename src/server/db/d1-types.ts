/**
 * Cloudflare Workers 绑定类型。
 *
 * 刻意不引 @cloudflare/workers-types：它会把整套 Workers 全局类型塞进来，
 * 与 Next.js 的 DOM lib 有已知的全局冲突。这里只声明本项目真正用到的 D1 子集，
 * 几十行、零依赖、类型冲突免疫。
 */

export type D1Value = string | number | null | ArrayBuffer;

export type D1Meta = {
  changes?: number;
  duration?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
};

export type D1RunResult = { success: boolean; meta: D1Meta };
export type D1AllResult<T> = { success: boolean; results: T[]; meta: D1Meta };

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1AllResult<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1AllResult<T>[]>;
  exec(query: string): Promise<{ count: number; duration?: number }>;
}
