"use client";

import { useState, type ReactNode } from "react";
import { createShareLink } from "@/lib/api-client";
import { renderChatShot } from "@/lib/wechat-shot";
import { buildShareCaption } from "@/features/analyze/presentation";
import type { AnalysisRecord } from "@/features/analyze/types";

type Status = { kind: "idle" | "busy" | "ok" | "error"; message?: string };

/**
 * 结果的三条出口：存图、复制配文、生成分享链接。
 *
 * 顺序是有讲究的。真实使用场景是「我想发给朋友问问」，最短的路径是存图 → 直接发微信，
 * 所以存图放第一个。复制配文是给「想在群里问一句」的人。分享链接最重，
 * 但它能带来回流，放在最后但明确写出「对方点开能看到全部 N 句」。
 */
export function ShareActions({ record }: { record: AnalysisRecord }) {
  const [shot, setShot] = useState<Status>({ kind: "idle" });
  const [caption, setCaption] = useState<Status>({ kind: "idle" });
  const [link, setLink] = useState<Status>({ kind: "idle" });

  const analyzedCount = record.snapshot.analyzed.filter((l) => !l.failed).length;

  async function saveShot() {
    setShot({ kind: "busy" });
    try {
      const blob = await renderChatShot({
        herName: record.input.herName ?? "她",
        lines: record.snapshot.lines,
        analyzed: record.snapshot.analyzed,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `懂你-${record.id.slice(0, 6)}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // 立刻 revoke 会让部分浏览器的下载中断，延后释放
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setShot({ kind: "ok", message: "存好了，去微信发出去" });
    } catch (error) {
      setShot({
        kind: "error",
        message: error instanceof Error ? error.message : "图没存下来，直接截屏也一样。",
      });
    }
  }

  async function copyCaption() {
    setCaption({ kind: "busy" });
    try {
      await navigator.clipboard.writeText(buildShareCaption(record));
      setCaption({ kind: "ok", message: "已复制，去粘贴吧" });
    } catch {
      setCaption({ kind: "error", message: "复制不了，长按选中也行。" });
    }
  }

  async function makeLink() {
    setLink({ kind: "busy" });
    try {
      const { path } = await createShareLink(record.id);
      const url = `${window.location.origin}${path}`;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      setLink({ kind: "ok", message: `链接已复制：${url}` });
    } catch (error) {
      setLink({
        kind: "error",
        message: error instanceof Error ? error.message : "链接没生成出来，再试一次。",
      });
    }
  }

  return (
    <section className="cardback rounded-[var(--radius-card)] p-5">
      <h3 className="font-display text-[11px] tracking-[0.3em] text-gold-quiet uppercase">
        拿去用
      </h3>
      <div className="gold-rule my-4" />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <ActionButton onClick={saveShot} busy={shot.kind === "busy"} primary>
          存成聊天截图
        </ActionButton>
        <ActionButton onClick={copyCaption} busy={caption.kind === "busy"}>
          复制分享配文
        </ActionButton>
        <ActionButton onClick={makeLink} busy={link.kind === "busy"}>
          生成分享链接
        </ActionButton>
      </div>

      <div className="mt-3 space-y-1.5">
        {[shot, caption, link]
          .filter((s) => s.kind === "error" || s.kind === "ok")
          .map((s, i) => (
            <p
              key={i}
              className="text-[12px] leading-relaxed break-all"
              style={{ color: s.kind === "error" ? "var(--color-danger-2)" : "var(--color-gold-quiet)" }}
            >
              {s.message}
            </p>
          ))}
      </div>

      <p className="mt-3.5 text-[11.5px] leading-relaxed text-ink-faint">
        分享链接对方点开就能看到全部 {analyzedCount} 句的解读，不需要登录。
        <br />
        截图在你的浏览器里画出来，聊天记录不会再传一次。
      </p>
    </section>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  primary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  busy: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="h-11 rounded-[10px] px-3 text-[13.5px] transition-[opacity,transform] active:scale-[0.985] disabled:opacity-45"
      style={
        primary
          ? { background: "var(--color-gold)", color: "#241a05" }
          : { border: "1px solid var(--color-night-edge)", color: "var(--color-gold-quiet)" }
      }
    >
      {busy ? "处理中…" : children}
    </button>
  );
}
