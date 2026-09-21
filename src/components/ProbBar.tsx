import { rankedProbabilities } from "@/features/analyze/presentation";

type Props = {
  /** 命中的那一项（会被高亮） */
  topKey: string;
  topLabel: string;
  probabilities: Record<string, number>;
  /** key → 中文标签，用于展开「其他可能」 */
  labels: Record<string, string>;
  /** 只显示前几项，其余折叠 */
  maxVisible?: number;
  accent?: string;
};

/**
 * 概率条。
 *
 * 只有「命中项」给一条完整的金色长条，「其他可能」用细线表示 ——
 * 因为用户要读的是一个结论加上它的把握程度，不是五个等重的选项。
 * 把所有选项画成等宽条形反而是误导：看起来像是「五个答案并列」。
 */
export function ProbBar({
  topKey,
  topLabel,
  probabilities,
  labels,
  maxVisible = 4,
  accent = "var(--color-gold)",
}: Props) {
  const ranked = rankedProbabilities(probabilities, labels);
  const top = ranked.find((r) => r.key === topKey) ?? ranked[0];
  const topValue = top?.value ?? 0;
  const others = ranked.filter((r) => r.key !== top?.key).slice(0, maxVisible - 1);

  return (
    <div className="mt-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14.5px] leading-snug text-ink">{topLabel}</span>
        <span className="tabnum shrink-0 font-display text-[13px]" style={{ color: accent }}>
          {Math.round(topValue * 100)}%
        </span>
      </div>

      <div className="prob-track mt-2 h-[5px] w-full">
        <div
          className="prob-fill h-full"
          style={{
            width: `${Math.max(3, Math.round(topValue * 100))}%`,
            background: `linear-gradient(90deg, ${accent}, ${accent})`,
            opacity: 0.85,
          }}
        />
      </div>

      {others.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {others.map((item) => (
            <li key={item.key} className="flex items-center gap-2.5">
              <span
                className="w-[120px] shrink-0 truncate text-[11.5px] text-ink-faint"
                title={item.label}
              >
                {item.label}
              </span>
              <span className="prob-track h-[3px] flex-1">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(2, Math.round(item.value * 100))}%`,
                    background: "var(--color-gold-dim)",
                    opacity: 0.75,
                  }}
                />
              </span>
              <span className="tabnum w-[34px] shrink-0 text-right text-[11px] text-ink-faint">
                {Math.round(item.value * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
