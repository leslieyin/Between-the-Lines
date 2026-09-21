"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "@/components/Composer";
import { ResultView } from "@/components/ResultView";
import { SpeakerPicker } from "@/components/SpeakerPicker";
import { parseConversation } from "@/features/analyze/parse";
import { analyze, ApiError, getProfile, saveProfile } from "@/lib/api-client";
import type { AnalysisRecord } from "@/features/analyze/types";

/** 「我是谁」存在本机：这是设备级的界面偏好，不是需要跨端同步的数据，没必要占数据库。 */
const YOU_ARE_KEY = "huawaiyin.youAre";

/**
 * 主流程容器。整个页面只有这一处持有状态。
 *
 * 三个体验上的决定：
 *  1. **边打边认人**。粘贴的一大段文本里如果出现了两个真实昵称，选择器立刻出现 ——
 *     不用等到点了按钮才被告知「没认出哪句是她说的」。
 *  2. **立刻滚到结果**。算完之后如果不滚，手机上用户会以为没反应（结果在首屏之外）。
 *  3. **关系背景自动记住**。填过一次就不该再填第二次，提交时顺手存到服务端档案；
 *     失败也不阻断分析，这只是个加速项。
 */
export function Analyzer() {
  const [raw, setRaw] = useState("");
  const [herName, setHerName] = useState("");
  const [youAre, setYouAre] = useState<string | null>(null);
  const [relation, setRelation] = useState("");
  const [extra, setExtra] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisRecord | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);

  // 首屏拉一次档案，把上次填的关系背景带回来；顺便取回本机记着的「我是谁」
  useEffect(() => {
    let alive = true;
    try {
      const saved = window.localStorage.getItem(YOU_ARE_KEY);
      if (saved) setYouAre(saved);
    } catch {
      // 隐私模式下 localStorage 会抛异常，静默忽略即可 —— 这只是个便利项
    }
    getProfile()
      .then((profile) => {
        if (!alive) return;
        setHerName((v) => v || profile.herName || "");
        setRelation((v) => v || profile.relation || "");
        setExtra((v) => v || profile.extra || "");
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setProfileLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 每次输入变化都本地跑一遍解析，只为拿到「出现了几个说话人」。
   * 这是纯函数，和提交时服务端跑的是同一份实现，不会出现「前端说两个人、后端说一个人」。
   *
   * 包 try/catch 是因为它在 render 期间执行 —— 真出了意外也只该是「选择器不出现」，
   * 绝不能因为一段奇怪的粘贴内容把整页打崩。
   */
  const detection = useMemo(() => {
    try {
      return parseConversation(raw, { herName, youAre });
    } catch {
      return null;
    }
  }, [raw, herName, youAre]);

  function pickYou(label: string) {
    setYouAre(label);
    try {
      window.localStorage.setItem(YOU_ARE_KEY, label);
    } catch {
      // 同上，存不下就算了下一次再选
    }
  }

  async function handleSubmit() {
    if (busy) return;
    setBusy(true);
    setError(null);

    if (profileLoaded) {
      void saveProfile({
        herName: herName.trim() || null,
        relation: relation.trim() || null,
        extra: extra.trim() || null,
      }).catch(() => undefined);
    }

    try {
      const record = await analyze({
        raw,
        herName: herName.trim() || null,
        youAre: youAre?.trim() || null,
        relation: relation.trim() || null,
        extra: extra.trim() || null,
      });
      setResult(record);
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "算的时候出了点问题，把记录拆短一点再试一次。",
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * 指认结果存在本机、跨对话复用，所以每次都要确认它属于当前这段内容 —— 对不上就当作没选。
   *
   * 不这样做会出一个很难发现的错：上一段聊天里选的是「Leslie」，新贴的这段是别人跟你的对话，
   * 解析器会因为「只有两个说话人 + 有一个是我」而把**另外两个人一起当成「她」**，
   * 于是把对方的、甚至无关人的话全都算进去，而界面上看不出任何异常。
   */
  const youAreMatches = youAre !== null && detection !== null && detection.youAreMatched;

  useEffect(() => {
    // 对不上就顺手把本机那个值也清掉：留着它只会让下一段对话看到一个与内容无关的选中态。
    if (youAre !== null && detection !== null && !detection.youAreMatched && detection.candidates.length > 0) {
      setYouAre(null);
      try {
        window.localStorage.removeItem(YOU_ARE_KEY);
      } catch {
        // 隐私模式下 localStorage 会抛异常，忽略
      }
    }
  }, [youAre, detection]);

  /**
   * 选择器什么时候出现：候选 ≥2，且「还没指认」或「已指认了其中一个」。
   *
   * 刻意不加 `busy` 这个条件 —— 指认之后面板必须一直在。点完就整块消失的话，
   * 用户既看不到「那就来算「gaoo」说的话」这句确认，也没机会改主意；
   * 分析过程中闪一下不见，更容易让人以为刚才那下没生效。
   */
  const showPicker =
    detection !== null &&
    detection.candidates.length >= 2 &&
    (detection.needsDisambiguation || youAreMatches);

  return (
    <div className="space-y-6">
      <header className="mb-6">
        <h1
          className="font-display text-[30px] leading-[1.32] sm:text-[38px]"
          style={{ color: "var(--color-ink)" }}
        >
          她那句话
          <br />
          到底什么意思
        </h1>
        <p className="mt-4 max-w-[30em] text-[15px] leading-[1.8]" style={{ color: "var(--color-ink-soft)" }}>
          她说「随便」、「没事」、「你最好是」的时候，心里在想什么。
          把聊天记录贴进来，她说的每一句都给你算一遍。
        </p>
      </header>

      <Composer
        raw={raw}
        onRawChange={setRaw}
        herName={herName}
        onHerNameChange={setHerName}
        relation={relation}
        onRelationChange={setRelation}
        extra={extra}
        onExtraChange={setExtra}
        busy={busy}
        onSubmit={handleSubmit}
        speakerPicker={
          showPicker && detection ? (
            <SpeakerPicker
              candidates={detection.candidates}
              youAre={youAreMatches ? youAre : null}
              onPick={pickYou}
              herName={herName}
            />
          ) : null
        }
      />

      {error && (
        <div
          className="rounded-[12px] px-4 py-3 text-[13px] leading-relaxed"
          style={{ border: "1px solid var(--color-danger-2)", color: "var(--color-danger-2)" }}
          role="alert"
        >
          {error}
        </div>
      )}

      <div ref={resultRef} className="scroll-mt-4">
        {busy && <SkeletonDeck />}
        {!busy && result && <ResultView record={result} />}
      </div>

      {!busy && !result && <Explainer />}
    </div>
  );
}

/** 等待时的骨架：先用几张空牌占住位置，比一个转圈更能说明「马上会出来什么」。 */
function SkeletonDeck() {
  return (
    <div className="space-y-3.5" aria-live="polite" aria-busy>
      <p className="text-center text-[13px] text-gold-quiet">
        正在逐句算，大概要十几秒。别急着关。
      </p>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="cardback rounded-[var(--radius-card)] p-5"
          style={{ opacity: 0.5 - i * 0.12 }}
        >
          <div className="h-3 w-16 rounded" style={{ background: "var(--color-night-edge)" }} />
          <div className="mt-4 h-5 w-3/4 rounded" style={{ background: "var(--color-night-edge)" }} />
          <div className="mt-5 h-2.5 w-full rounded" style={{ background: "var(--color-night-edge)" }} />
          <div className="mt-3 h-2.5 w-2/3 rounded" style={{ background: "var(--color-night-edge)" }} />
        </div>
      ))}
    </div>
  );
}

function Explainer() {
  return (
    <section className="mt-14 border-t pt-6" style={{ borderColor: "var(--color-night-edge)" }}>
      <h2 className="text-[15px]" style={{ color: "var(--color-ink)" }}>
        这些数字是怎么来的
      </h2>
      <p className="mt-2 max-w-[34em] text-[13.5px] leading-[1.85]" style={{ color: "var(--color-ink-soft)" }}>
        背后跑的模型只会打分，不会写字。选项是提前定死的（确认在乎、表达不满、想要行动…），
        它只负责给每个选项算一个概率。所以它编不出一个不存在的答案 ——
        也所以它只能算，不能陪你聊。
      </p>
      <p className="mt-3 max-w-[34em] text-[13.5px] leading-[1.85]" style={{ color: "var(--color-ink-soft)" }}>
        你贴进来的聊天记录只会用来算这一次，除非你自己在历史里留着。
        想清掉，去
        <a href="/history" className="mx-1 underline decoration-dotted">
          历史
        </a>
        一键删掉就行。
      </p>
    </section>
  );
}
