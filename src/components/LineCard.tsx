"use client";

import { useState, type ReactNode } from "react";
import { DangerMeter } from "@/components/DangerMeter";
import { ProbBar } from "@/components/ProbBar";
import { LABELS } from "@/features/analyze/prompts";
import { confidenceNote, dangerMeta } from "@/features/analyze/presentation";
import type { LineAnalysis } from "@/features/analyze/types";

type Props = {
  line: LineAnalysis;
  /** 「她说的第几句」 */
  ordinal: number;
  /** 入场错峰，让卡片一张张翻出来 */
  delayMs: number;
};

export function LineCard({ line, ordinal, delayMs }: Props) {
  const [open, setOpen] = useState(false);

  if (line.failed) {
    return (
      <article
        className="cardback deal-in rounded-[var(--radius-card)] p-4 sm:p-5"
        style={{ animationDelay: `${delayMs}ms` }}
      >
        <Header ordinal={ordinal} text={line.text} />
        <p className="mt-4 text-[13px] text-ink-faint">这段没算出来，换一段试试。</p>
      </article>
    );
  }

  const meta = dangerMeta(line.danger.level);
  const ironic = line.isIronic >= 0.5;
  const ironicStrength = Math.round(line.isIronic * 100);
  const literalOnly = line.worthReading < 0.35;
  const intentNote = confidenceNote(line.intent.confidence);
  const needNote = confidenceNote(line.need.confidence);

  return (
    <article
      className="cardback deal-in rounded-[var(--radius-card)] p-4 sm:p-5"
      style={{ animationDelay: `${delayMs}ms`, borderColor: meta.color }}
    >
      <Header ordinal={ordinal} text={line.text} level={line.danger.level} />

      {/* 一句话结论：反话 / 就是字面意思 —— 这是用户最先想知道的 */}
      {(ironic || literalOnly) && (
        <p
          className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-[5px] text-[12px]"
          style={{
            border: `1px solid ${ironic ? meta.color : "var(--color-night-edge)"}`,
            color: ironic ? meta.color : "var(--color-ink-soft)",
            background: "rgba(17,12,34,0.5)",
          }}
        >
          {ironic ? (
            <>
              <span aria-hidden>◆</span> 这句要反着听（{ironicStrength}% 判断为反话）
            </>
          ) : (
            <>
              <span aria-hidden>○</span> 就是字面意思
            </>
          )}
        </p>
      )}

      <div className="mt-4 space-y-4">
        <Field title="她真正想说的">
          <ProbBar
            topKey={line.intent.key}
            topLabel={line.intent.label}
            probabilities={line.intent.probabilities}
            labels={LABELS.intent}
            accent={meta.color}
          />
          {intentNote && <Note text={intentNote} />}
        </Field>

        <Field title="她此刻需要">
          <ProbBar
            topKey={line.need.key}
            topLabel={line.need.label}
            probabilities={line.need.probabilities}
            labels={LABELS.need}
            accent={meta.color}
          />
          {needNote && <Note text={needNote} />}
        </Field>

        <Field title="危险等级">
          <DangerMeter level={line.danger.level} />
        </Field>
      </div>

      {/* 建议动作单独一个色块：它是这份分析里唯一「让你去做」的东西，必须显眼 */}
      <div
        className="mt-4 rounded-[12px] px-3.5 py-3"
        style={{ background: "rgba(216,181,109,0.07)", border: "1px solid rgba(216,181,109,0.22)" }}
      >
        <p className="text-[11px] tracking-[0.18em] text-gold-dim uppercase">建议动作</p>
        <p className="mt-1 text-[14px] leading-relaxed" style={{ color: "var(--color-gold-bright)" }}>
          {line.move.label}
        </p>
        {open && (
          <ul className="mt-2.5 space-y-1.5 border-t pt-2.5" style={{ borderColor: "rgba(216,181,109,0.18)" }}>
            {Object.entries(line.move.probabilities)
              .sort((a, b) => b[1] - a[1])
              .map(([key, value]) => (
                <li key={key} className="flex justify-between gap-3 text-[12px]" style={{ color: "var(--color-ink-soft)" }}>
                  <span className="truncate">{LABELS.move[key] ?? key}</span>
                  <span className="tabnum shrink-0">{Math.round(value * 100)}%</span>
                </li>
              ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-[11.5px] transition-colors hover:text-gold-bright"
          style={{ color: "var(--color-gold-quiet)" }}
        >
          {open ? "收起其他做法" : "其他做法也说得通？看全部概率"}
        </button>
      </div>
    </article>
  );
}

function Header({ ordinal, text, level }: { ordinal: number; text: string; level?: number }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 pt-[5px] font-display text-[10.5px] tracking-[0.22em] text-ink-faint">
        NO.{String(ordinal).padStart(2, "0")}
      </span>
      <blockquote className="quote min-w-0 flex-1 text-[17px] leading-[1.6] whitespace-pre-wrap sm:text-[18px]" style={{ color: "var(--color-ink)" }}>
        「{text}」
      </blockquote>
      {typeof level === "number" && (
        <span className="pt-[2px]">
          <DangerMeter level={level} compact />
        </span>
      )}
    </div>
  );
}

function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] tracking-[0.18em] text-ink-faint uppercase">{title}</p>
      {children}
    </div>
  );
}

function Note({ text }: { text: string }) {
  return <p className="mt-1.5 text-[11.5px] text-ink-faint">· {text}</p>;
}
