"use client";

import { useRef, useState, type ReactNode } from "react";

export const SAMPLE_CHAT = `她：你今天是不是又忘了我跟你说过什么？
我：记得，你先别提示我，让我自己说。
她：那你说。
我：等一下，我想说完整一点。
她：你最好是。
我：我想起来了。你昨天跟我说周末想出去吃饭，而且你不想每次都是你来安排。
她：所以呢？
我：所以这次我来安排，餐厅和时间我定好再告诉你，你只负责去。
她：这还差不多。`;

type Props = {
  raw: string;
  onRawChange: (value: string) => void;
  herName: string;
  onHerNameChange: (value: string) => void;
  relation: string;
  onRelationChange: (value: string) => void;
  extra: string;
  onExtraChange: (value: string) => void;
  busy: boolean;
  onSubmit: () => void;
  /**
   * 「这两个人里哪个是你」的选择器。
   * 用插槽而不是把候选、选中值、回调都塞进 Props —— 那是另一块独立的状态，
   * Composer 没必要知道它的存在，只需要知道「这里要放点什么」。
   */
  speakerPicker?: ReactNode;
};

/**
 * 输入区。
 *
 * 「从微信粘贴」是一个真实的按钮而不是文案提示：手机上从微信复制过来再长按输入框粘贴，
 * 中间那一步会劝退一半人。能一步读到剪贴板就一步读到。
 *
 * 关系背景默认折叠。绝大多数人只想粘一段对话点一下，把三个输入框摆在首屏会让人以为
 * 这是个「填表工具」而不是「一个动作就能出结果」的东西。
 */
export function Composer({
  raw,
  onRawChange,
  herName,
  onHerNameChange,
  relation,
  onRelationChange,
  extra,
  onExtraChange,
  busy,
  onSubmit,
  speakerPicker,
}: Props) {
  const [hint, setHint] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function pasteFromClipboard() {
    setHint(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text || text.trim() === "") {
        setHint("剪贴板里没有文字。先去微信长按消息、多选、复制。");
        return;
      }
      onRawChange(text.trim());
      textareaRef.current?.focus();
    } catch {
      setHint("读不到剪贴板。长按输入框选「粘贴」也可以。");
    }
  }

  return (
    <section aria-labelledby="paste-heading">
      <h2 id="paste-heading" className="sr-only">
        粘贴聊天记录
      </h2>

      <div
        className="cardback relative rounded-[var(--radius-card)] p-3.5 sm:p-4"
        style={{ borderColor: "var(--color-gold-dim)" }}
      >
        <label htmlFor="raw" className="sr-only">
          聊天记录
        </label>
        <textarea
          id="raw"
          ref={textareaRef}
          rows={9}
          spellCheck={false}
          value={raw}
          onChange={(e) => onRawChange(e.target.value)}
          className="relative z-10 w-full resize-y bg-transparent p-2 text-[15px] leading-[1.95] outline-none placeholder:text-ink-faint"
          style={{ color: "var(--color-ink)" }}
          placeholder={"她：你今天是不是又忘了我跟你说过什么？\n我：记得。\n她：那你说。"}
        />
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={pasteFromClipboard}
          className="h-11 flex-1 rounded-[10px] text-[14px] transition-colors hover:text-gold-bright"
          style={{ border: "1px solid var(--color-night-edge)", color: "var(--color-gold-quiet)" }}
        >
          从微信粘贴（整段）
        </button>
        <button
          type="button"
          onClick={() => {
            onRawChange("");
            setHint(null);
          }}
          className="h-11 rounded-[10px] px-4 text-[14px] transition-colors hover:text-ink"
          style={{ border: "1px solid var(--color-night-edge)", color: "var(--color-ink-faint)" }}
        >
          清空
        </button>
      </div>

      {hint && <p className="mt-2 text-[12.5px] text-ink-faint">{hint}</p>}

      {speakerPicker}

      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || raw.trim().length < 2}
        className="font-display mt-4 h-14 w-full rounded-[12px] text-[17px] transition-[opacity,transform] active:scale-[0.99] disabled:opacity-40"
        style={{ background: "var(--color-gold)", color: "#241a05" }}
      >
        {busy ? "正在逐句算…" : "看看她什么意思"}
      </button>

      <p className="mt-2.5 text-center text-[12.5px] leading-relaxed text-ink-faint">
        {raw.trim().length < 2 ? (
          <>
            框里留了个例子，直接点上面的按钮就能看。或者
            <button
              type="button"
              onClick={() => onRawChange(SAMPLE_CHAT)}
              className="underline decoration-dotted hover:text-gold"
            >
              载入这个例子
            </button>
            。
          </>
        ) : (
          <>换成你们自己的记录会更准，尤其填上她的备注名。</>
        )}
      </p>

      <details
        className="mt-5 rounded-[10px]"
        style={{ border: "1px solid var(--color-night-edge)" }}
        open={contextOpen}
        onToggle={(e) => setContextOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary
          className="cursor-pointer list-none px-4 py-3 text-[13px] transition-colors hover:text-gold-bright"
          style={{ color: "var(--color-gold-quiet)" }}
        >
          {contextOpen ? "− " : "+ "}告诉它你们什么关系，会更准（不填也行）
        </summary>
        <div className="space-y-3 px-4 pb-4">
          <Field label="她的备注名" hint="对话里出现这个名字时，就认定是她在说话">
            <input
              value={herName}
              onChange={(e) => onHerNameChange(e.target.value)}
              maxLength={24}
              placeholder="宝儿"
              className="h-11 w-full rounded-[8px] px-3 text-[14px] outline-none placeholder:text-ink-faint"
              style={{
                background: "var(--color-night)",
                border: "1px solid var(--color-night-edge)",
                color: "var(--color-ink)",
              }}
            />
          </Field>
          <Field label="你们什么关系" hint="在一起多久、什么阶段，会影响同一句话的分量">
            <input
              value={relation}
              onChange={(e) => onRelationChange(e.target.value)}
              maxLength={120}
              placeholder="情侣，在一起 2 年"
              className="h-11 w-full rounded-[8px] px-3 text-[14px] outline-none placeholder:text-ink-faint"
              style={{
                background: "var(--color-night)",
                border: "1px solid var(--color-night-edge)",
                color: "var(--color-ink)",
              }}
            />
          </Field>
          <Field label="还发生了什么" hint="当天或最近的事，一句话就够">
            <input
              value={extra}
              onChange={(e) => onExtraChange(e.target.value)}
              maxLength={300}
              placeholder="昨天答应她的事我忘了…"
              className="h-11 w-full rounded-[8px] px-3 text-[14px] outline-none placeholder:text-ink-faint"
              style={{
                background: "var(--color-night)",
                border: "1px solid var(--color-night-edge)",
                color: "var(--color-ink)",
              }}
            />
          </Field>
        </div>
      </details>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px]" style={{ color: "var(--color-ink-soft)" }}>
        {label}
      </span>
      {children}
      <span className="mt-1.5 block text-[11px] text-ink-faint">{hint}</span>
    </label>
  );
}
