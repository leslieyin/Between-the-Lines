"use client";

import type { SpeakerCandidate } from "@/features/analyze/parse";

type Props = {
  candidates: SpeakerCandidate[];
  /** 已选中的那个标签（你）。null = 还没指认。 */
  youAre: string | null;
  onPick: (label: string) => void;
  /** 用户填的她的备注名，用来提示「我只算谁」 */
  herName: string;
};

/**
 * 「这两个人里，哪个是你？」—— 指认自己。
 *
 * 为什么必须让用户点一下，而不是让他去填备注名：
 * 从微信复制出来的记录里说话人就是两个真实昵称（比如「gaoo」和「Leslie」）。
 * 解析器能看出这是两个不同的人在说话，但**没有任何办法知道哪个是他**。
 * 让人点一下是零成本的，让人手打一遍昵称则要精确到字符、还容易打错。
 *
 * 两条交互上的硬要求：
 *  1. **选中之后面板不能消失。** 点完就整块不见了的话，用户既看不到「那就来算「gaoo」说的话」
 *     这句确认，也没机会改主意。所以只要候选还在，面板就一直在，选中只是把那个按钮点亮。
 *  2. **提示文案必须跟着「选没选」走。** 没选的时候不能去算「除了你还有几个人」——
 *     那时候你还没说你是谁，算出来的是个假命题。
 */
export function SpeakerPicker({ candidates, youAre, onPick, herName }: Props) {
  const picked = youAre !== null;
  const others = picked ? candidates.filter((c) => c.label !== youAre) : [];

  return (
    <div
      className="mt-3 rounded-[12px] px-4 py-3.5"
      style={{ border: "1px solid var(--color-night-edge)", background: "rgba(17,12,34,0.45)" }}
    >
      <p className="text-[13.5px]" style={{ color: "var(--color-ink-soft)" }}>
        这两个人里，哪个是你？
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {candidates.map((candidate) => {
          const active = candidate.label === youAre;
          return (
            <button
              key={candidate.label}
              type="button"
              onClick={() => onPick(candidate.label)}
              aria-pressed={active}
              className="h-10 max-w-[46%] truncate rounded-[9px] px-4 text-[14px] transition-[background-color,color,transform] active:scale-[0.98]"
              style={
                active
                  ? { background: "var(--color-gold)", color: "#241a05", fontWeight: 500 }
                  : { border: "1px solid var(--color-night-edge)", color: "var(--color-gold-quiet)" }
              }
            >
              {candidate.label}
            </button>
          );
        })}
      </div>

      {/* 选完之后这行是「确认」而不是「提示」，要让它比未选时更显眼 ——
          用户点完那一下最想知道的就是「它到底认成谁了」。 */}
      <p
        className="mt-3 text-[13px] leading-relaxed"
        style={{ color: picked ? "var(--color-ink-soft)" : "var(--color-ink-faint)" }}
      >
        {!picked && "选一个，我才知道该算谁说的话。"}
        {picked && others.length === 1 && <>那就来算「{others[0]!.label}」说的话。</>}
        {picked && others.length === 0 && (
          <>上面只剩你一个人，把对话贴全一点，或者直接在下面填她的备注名。</>
        )}
        {picked && others.length > 1 && (
          <>
            除了你还有 {others.length} 个人。在下面把她的备注名填上（比如「{others[0]!.label}」），
            我就只算她说的。
          </>
        )}
      </p>

      {picked && others.length === 1 && herName.trim() !== "" && herName.trim() !== others[0]!.label && (
        <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "var(--color-gold-quiet)" }}>
          你填的备注名是「{herName.trim()}」，和这里的「{others[0]!.label}」不一样 —— 我会按备注名算。
        </p>
      )}
    </div>
  );
}
