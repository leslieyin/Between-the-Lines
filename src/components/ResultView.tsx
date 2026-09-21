import { ConversationPanel } from "@/components/ConversationPanel";
import { LineCard } from "@/components/LineCard";
import { ShareActions } from "@/components/ShareActions";
import { TrendChart } from "@/components/TrendChart";
import { ordinalInTranscript } from "@/features/analyze/presentation";
import type { AnalysisRecord } from "@/features/analyze/types";

type Props = {
  record: AnalysisRecord;
  /** 是否显示「存图 / 配文 / 分享」那一块 */
  showActions?: boolean;
  /** 分享页模式：不显示设备相关的东西，也不显示「今天只做一件事」的隐私提示 */
  shared?: boolean;
};

const STEP_LABELS = ["她说的每一句", "整段怎么看", "拿去用"];

/**
 * 结果页主体。主站、历史详情、分享页三处共用 —— 三处用同一份渲染，
 * 就不会出现「分享出去的图和我看到的不是同一张」这种最尴尬的问题。
 */
export function ResultView({ record, showActions = true, shared = false }: Props) {
  const { snapshot } = record;
  const analyzed = snapshot.analyzed;
  const failed = analyzed.filter((l) => l.failed).length;

  return (
    <div className="space-y-5">
      {snapshot.demo && (
        <div
          className="rounded-[12px] px-4 py-3 text-[12.5px] leading-relaxed"
          style={{ border: "1px solid var(--color-danger-2)", color: "var(--color-danger-2)" }}
        >
          演示模式：这些数字不是模型算的，是按固定规则生成的样例。填上 TYPESAFE_API_KEY 之后
          才会真的逐句送进 Jev。
        </div>
      )}

      <ConversationPanel conversation={snapshot.conversation} />

      <TrendChart
        lines={snapshot.lines}
        analyzed={analyzed}
        trendLabel={snapshot.conversation.trend.label}
      />

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[11px] tracking-[0.3em] text-gold-quiet uppercase">
            {STEP_LABELS[0]}
          </h2>
          <span className="text-[11.5px] text-ink-faint">
            {analyzed.length} 句
            {failed > 0 ? `，其中 ${failed} 句没算出来` : ""}
          </span>
        </div>

        <div className="space-y-3.5">
          {analyzed.map((line, i) => (
            <LineCard
              key={line.index}
              line={line}
              ordinal={ordinalInTranscript(snapshot.lines, line.index)}
              delayMs={i * 18}
            />
          ))}
        </div>
      </section>

      {showActions && <ShareActions record={record} />}

      {!shared && (
        <p className="text-[12px] leading-relaxed text-ink-faint">
          这次分析只在你自己的浏览器上有记录（存在 Cloudflare D1 里，按设备隔离）。
          觉得不该留就去 <a href="/history" className="underline decoration-dotted">历史</a> 一键清空。
          分享链接拿到的人能看，所以别把不想让别人看的聊天记录分享出去。
        </p>
      )}
    </div>
  );
}
