/**
 * 受控并发。
 *
 * 存在的理由：一批分析要打 N 个 Jev 请求，全部并发会在长对话下把上游打爆
 * （还会撞上 Workers 的并发与 CPU 预算）。这里保证同时在飞的请求数不超过 limit，
 * 但整体仍是并行而非串行 —— 对总耗时影响很小，对稳定性影响很大。
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return results;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}
