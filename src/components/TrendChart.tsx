import { dangerMeta } from "@/features/analyze/presentation";
import type { LineAnalysis, ParsedLine } from "@/features/analyze/types";

type Props = {
  lines: ParsedLine[];
  analyzed: LineAnalysis[];
  /** 整段的走势判断文案（来自 conversation.trend.label） */
  trendLabel: string;
};

const WIDTH = 600;
const HEIGHT = 132;
const PAD_X = 14;
const PAD_Y = 18;

/**
 * 危险走势图。
 *
 * 横轴是「她说话的顺序」，纵轴是危险等级 0..3。刻意不画坐标轴刻度 ——
 * 这张图要回答的问题只有一个：「这段对话是越聊越好还是越聊越糟」，
 * 加上刻度反而让人去读数字而不是看趋势。
 *
 * 用面积图而不是折线：填充的色块从下往上长，焦虑感会随着后半段升高自然加重，
 * 这是折线给不了的信息。
 */
export function TrendChart({ lines, analyzed, trendLabel }: Props) {
  const usable = analyzed.filter((l) => !l.failed);
  if (usable.length < 2) return null;

  const herLines = lines.filter((l) => l.speaker === "her");

  const points = usable.map((line, i) => {
    const x = PAD_X + (i / Math.max(1, usable.length - 1)) * (WIDTH - PAD_X * 2);
    // 等级 0..3 映射到图高，0 在底部
    const y = HEIGHT - PAD_Y - (line.danger.level / 3) * (HEIGHT - PAD_Y * 2);
    return { x, y, line };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1]!.x.toFixed(1)},${HEIGHT - PAD_Y} L${points[0]!.x.toFixed(1)},${HEIGHT - PAD_Y} Z`;

  return (
    <section className="cardback rounded-[var(--radius-card)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px]" style={{ color: "var(--color-ink)" }}>
          这段对话的危险走势
        </h3>
        <span className="text-[12px]" style={{ color: "var(--color-gold-quiet)" }}>
          {trendLabel}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-3 w-full"
        role="img"
        aria-label={`共 ${usable.length} 句被解读，危险走势：${trendLabel}`}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-danger-3)" stopOpacity="0.32" />
            <stop offset="55%" stopColor="var(--color-danger-2)" stopOpacity="0.14" />
            <stop offset="100%" stopColor="var(--color-gold)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* 三条淡淡的水平参考线，暗示等级台阶的存在但不标数字 */}
        {[0, 1, 2, 3].map((level) => {
          const y = HEIGHT - PAD_Y - (level / 3) * (HEIGHT - PAD_Y * 2);
          return (
            <line
              key={level}
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={y}
              y2={y}
              stroke="var(--color-night-edge)"
              strokeWidth={1}
              strokeDasharray={level === 0 ? "0" : "3 6"}
            />
          );
        })}

        <path d={areaPath} fill="url(#trend-fill)" />
        <path
          d={linePath}
          fill="none"
          stroke="var(--color-gold)"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((p) => (
          <g key={p.line.index}>
            <circle cx={p.x} cy={p.y} r={4.4} fill={dangerMeta(p.line.danger.level).color} />
            <circle cx={p.x} cy={p.y} r={8} fill="none" stroke={dangerMeta(p.line.danger.level).color} strokeOpacity={0.28} />
          </g>
        ))}
      </svg>

      <p className="mt-2 text-[11.5px] text-ink-faint">
        横轴是她说话的顺序（共 {herLines.length} 句，其中 {usable.length} 句算出来了），纵轴是危险等级。
      </p>
    </section>
  );
}
