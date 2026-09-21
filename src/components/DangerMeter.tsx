import { dangerMeta } from "@/features/analyze/presentation";

/**
 * 危险等级指示器。
 *
 * 用「四个格子点亮几个」而不是进度条或百分比 —— 危险不是连续量，把它画成 73% 会让人
 * 以为多算一位小数就多一分准确。四格台阶传达的是「处在第几档」，这才是模型真正回答的问题。
 */
export function DangerMeter({ level, compact = false }: { level: number; compact?: boolean }) {
  const meta = dangerMeta(level);

  if (compact) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] whitespace-nowrap"
        style={{
          border: `1px solid ${meta.color}`,
          color: meta.color,
          background: "rgba(17,12,34,0.55)",
        }}
      >
        <span className="h-[5px] w-[5px] rounded-full" style={{ background: meta.color }} />
        {meta.short}
      </span>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-[3px]" aria-hidden>
          {[0, 1, 2, 3].map((step) => (
            <span
              key={step}
              className="h-[14px] w-[9px] rounded-[2px] transition-colors"
              style={{
                background: step <= level ? dangerMeta(step).color : "rgba(122,101,53,0.2)",
                opacity: step <= level ? 1 : 1,
              }}
            />
          ))}
        </div>
        <span className="text-[14px]" style={{ color: meta.color }}>
          {meta.short}
        </span>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">{meta.full}</p>
    </div>
  );
}
