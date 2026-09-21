import { ProbBar } from "@/components/ProbBar";
import { LABELS } from "@/features/analyze/prompts";
import { confidenceNote, trendMeta } from "@/features/analyze/presentation";
import type { ConversationJudgment } from "@/features/analyze/types";

/**
 * 整段结论。
 *
 * 三块内容的优先级是刻意的：先给「现在最该做的一件事」（可执行），
 * 再给关系状态（理解现状），最后才是走势（趋势判断）。用户真正会照着做的只有第一块。
 */
export function ConversationPanel({ conversation }: { conversation: ConversationJudgment }) {
  const meta = trendMeta(conversation.trend.level);
  const verdictNote = confidenceNote(conversation.verdict.confidence);

  return (
    <section className="cardback rounded-[var(--radius-card)] p-5 sm:p-6">
      <h2 className="font-display text-[11px] tracking-[0.3em] text-gold-quiet uppercase">
        整段的看法
      </h2>
      <div className="gold-rule my-4" />

      <div
        className="rounded-[12px] px-4 py-3.5"
        style={{ background: "rgba(216,181,109,0.08)", border: "1px solid rgba(216,181,109,0.24)" }}
      >
        <p className="text-[11px] tracking-[0.18em] text-gold-dim uppercase">今天只做一件事的话</p>
        <p className="mt-1.5 font-display text-[19px] leading-snug" style={{ color: "var(--color-gold-bright)" }}>
          {conversation.priority.label}
        </p>
        <ul className="mt-2.5 space-y-1">
          {Object.entries(conversation.priority.probabilities)
            .sort((a, b) => b[1] - a[1])
            .slice(1, 3)
            .map(([key, value]) => (
              <li key={key} className="flex justify-between gap-3 text-[12px]" style={{ color: "var(--color-ink-soft)" }}>
                <span className="truncate">{LABELS.priority[key] ?? key}</span>
                <span className="tabnum shrink-0">{Math.round(value * 100)}%</span>
              </li>
            ))}
        </ul>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <p className="text-[11px] tracking-[0.18em] text-ink-faint uppercase">关系现在的位置</p>
          <div className="mt-2">
            <ProbBar
              topKey={conversation.verdict.key}
              topLabel={conversation.verdict.label}
              probabilities={conversation.verdict.probabilities}
              labels={LABELS.verdict}
              maxVisible={3}
            />
          </div>
          {verdictNote && <p className="mt-1.5 text-[11.5px] text-ink-faint">· {verdictNote}</p>}
        </div>

        <div>
          <p className="text-[11px] tracking-[0.18em] text-ink-faint uppercase">气氛往哪走</p>
          <div className="mt-2 flex items-center gap-2.5">
            <span
              className="h-[10px] w-[10px] shrink-0 rounded-full"
              style={{ background: meta.color }}
              aria-hidden
            />
            <span className="text-[14px]" style={{ color: meta.color }}>
              {meta.short}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-[3px]" aria-hidden>
            {[0, 1, 2, 3, 4].map((step) => (
              <span
                key={step}
                className="h-[14px] w-[9px] rounded-[2px]"
                style={{
                  background:
                    step <= conversation.trend.level
                      ? trendMeta(step).color
                      : "rgba(122,101,53,0.2)",
                }}
              />
            ))}
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">{meta.full}</p>
        </div>
      </div>
    </section>
  );
}
