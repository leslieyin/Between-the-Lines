"use client";

import { useEffect, useState } from "react";
import { ResultView } from "@/components/ResultView";
import { dangerMeta } from "@/features/analyze/presentation";
import type { AnalysisRecord, AnalysisSummary } from "@/features/analyze/types";
import { ApiError, clearAnalyses, getAnalysis, listAnalyses, removeAnalysis } from "@/lib/api-client";

/**
 * 历史记录。
 *
 * 定位是「找回上一次的结论」，不是「管理数据」。所以列表只给最有用的三个信息：
 * 第一句她说的话、危险等级、什么时候算的。其余的点开看原样结果。
 *
 * 「清空」刻意做成了两步确认 —— 这是一次不可逆的删除，而且用户往往在情绪里点它。
 */
export function HistoryView() {
  const [items, setItems] = useState<AnalysisSummary[] | null>(null);
  const [openRecord, setOpenRecord] = useState<AnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listAnalyses()
      .then((data) => setItems(data.items))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "历史读不出来了，刷新一下试试。");
        setItems([]);
      });
  }, []);

  async function open(id: string) {
    setError(null);
    try {
      setOpenRecord(await getAnalysis(id));
      requestAnimationFrame(() => {
        document.getElementById("history-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "这条打不开了。");
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await removeAnalysis(id);
      setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
      setOpenRecord((prev) => (prev && prev.id === id ? null : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删不掉，稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    setBusy(true);
    try {
      await clearAnalyses();
      setItems([]);
      setOpenRecord(null);
      setConfirmClear(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "清不掉，稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  if (items === null) {
    return <p className="text-[14px] text-ink-faint">正在读历史…</p>;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="font-display mb-2 text-[10px] tracking-[0.3em] text-gold-quiet uppercase">
            历史 · 只在这台设备上
          </p>
          <h1 className="font-display text-[24px]" style={{ color: "var(--color-ink)" }}>
            算过的对话
          </h1>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="shrink-0 pb-1 text-[12.5px] transition-colors hover:text-danger-2"
            style={{ color: "var(--color-ink-faint)" }}
          >
            一键清空
          </button>
        )}
      </header>

      {error && (
        <p className="text-[13px]" style={{ color: "var(--color-danger-2)" }} role="alert">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-[14px] leading-relaxed" style={{ color: "var(--color-ink-soft)" }}>
          还没有算过。回首页贴一段聊天记录，算完就会自动留在这里。
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => {
            const meta = dangerMeta(Math.round(item.peakDanger));
            return (
              <li key={item.id}>
                <div
                  className="cardback flex items-stretch gap-3 rounded-[14px] p-3.5"
                  style={{ borderColor: openRecord?.id === item.id ? "var(--color-gold)" : undefined }}
                >
                  <button
                    type="button"
                    onClick={() => open(item.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[14.5px]" style={{ color: "var(--color-ink)" }}>
                      {item.title}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-faint">
                      <span className="tabnum">{formatTime(item.createdAt)}</span>
                      <span>{item.herLines} 句</span>
                      <span style={{ color: meta.color }}>最高「{meta.short}」</span>
                      {item.shareSlug && <span className="text-gold-quiet">已分享</span>}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    disabled={busy}
                    className="shrink-0 px-2 text-[12px] text-ink-faint transition-colors hover:text-danger-2 disabled:opacity-40"
                    aria-label="删除这条"
                  >
                    删除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {confirmClear && (
        <div
          className="rounded-[12px] p-4"
          style={{ border: "1px solid var(--color-danger-3)" }}
          role="alertdialog"
        >
          <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--color-ink)" }}>
            清空之后 {items.length} 条记录和它们的分享链接都会失效，删了找不回来。
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={clearAll}
              disabled={busy}
              className="h-10 rounded-[8px] px-4 text-[13.5px] disabled:opacity-45"
              style={{ background: "var(--color-danger-3)", color: "#fff" }}
            >
              {busy ? "正在清…" : "确认清空"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="h-10 rounded-[8px] px-4 text-[13.5px]"
              style={{ border: "1px solid var(--color-night-edge)", color: "var(--color-ink-soft)" }}
            >
              算了
            </button>
          </div>
        </div>
      )}

      <div id="history-detail" className="scroll-mt-4">
        {openRecord && (
          <>
            <div className="gold-rule my-6" />
            <ResultView record={openRecord} />
          </>
        )}
      </div>
    </div>
  );
}

function formatTime(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return `今天 ${hm}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${hm}`;
}
