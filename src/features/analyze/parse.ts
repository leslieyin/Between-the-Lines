/**
 * 聊天记录解析：把用户粘贴的一坨文本切成「谁说了什么」。
 *
 * 分两遍扫：
 *   第一遍只做一件事 —— 认出「每一段话属于哪个标签」，完全不判定标签是谁。
 *   第二遍才根据 herName / youAre 给每个标签定性（她 / 我 / 其他人）。
 *
 * 为什么要拆两遍：从微信复制出来的记录里，说话人往往就是两个真实昵称（比如「gaoo」和
 * 「Leslie」）。第一遍不判定身份，才能把这两个昵称**原样交给用户去指认**——
 * 让用户点一下「哪个是我」，比让他手填备注名可靠得多。
 *
 * 支持的形态（都是从微信真实复制会遇到的）：
 *   A. 前缀式：`她：你今天是不是又忘了我跟你说过什么？`
 *   B. 昵称+时间抬头：`gaoo 2026-09-21 12:00` 或 `gaoo` 单独一行下面跟时间戳
 *   C. 多行消息：没有前缀的行接到上一条同一说话人的消息上
 *   D. 系统噪声：`撤回了一条消息`、`[图片]`、纯时间戳 —— 直接丢掉
 *
 * 解析是启发式的，所以刻意保守：**认不出来就归为「其他人」，绝不错判成她的发言**。
 * 少分析几句远好过多算错几句 —— 算错一句的代价是让用户照着错的方向去说话。
 */

import type { ParsedLine, Speaker } from "./types";

/** 指代「被解读的那一方」的常见写法。刻意把「他」也算进来：一对一聊天里它常用来指对方。 */
const HER_LABELS = new Set([
  "她",
  "他",
  "ta",
  "对方",
  "女朋友",
  "女友",
  "老婆",
  "媳妇",
  "宝贝",
  "宝宝",
  "亲爱的",
  "对象",
]);

/** 指代「你」的常见写法 */
const ME_LABELS = new Set(["我", "自己", "本人", "me", "myself", "you"]);

/**
 * 这些词后面经常跟冒号，但它们是正文不是说话人（「注意：」「其实：」）。
 * 不挡一下的话，一句「记住：明天去买菜」会凭空造出一个叫「记住」的说话人，
 * 用户在那个「哪个是你」的选择器里就会看到错误选项。
 */
const NOT_A_NAME = new Set([
  "注意","提示","备注","说明","记住","记着","原因","结果","重点","警告","提醒","补充",
  "例如","比如","其实","总之","首先","其次","最后","另外","不过","但是","所以","因为",
  "如果","然后","而且","可能","方法","步骤","第一","第二","第三","以上","如下","建议",
  "结论","顺便","对了","话说","还有","反正","总之","简单说","说白了","换句话说",
]);

/** 纯时间戳 / 日期行。要求至少含一个日期或时刻，避免把空字符串也算进去。 */
const TIMESTAMP_ONLY =
  /^(?:\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}:\d{2}(?::\d{2})?)$/;

/** 昵称 + 日期时间的抬头行 */
const HEADER_WITH_TIME = /^(.{1,20}?)\s+\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/;

/** 系统提示噪声 */
const NOISE = /^(以下是新消息|以上是打招呼的内容|.{0,12}撤回了一条消息|.{0,12}拍了拍.{0,12}|\[.{1,10}\])$/;

/** 形似昵称：中英文数字下划线间隔号，不含空格与句读 */
const NAME_LIKE = /^[\u4e00-\u9fffA-Za-z0-9_·．.\-]{1,16}$/;

const SENTENCE_PUNCT = /[，。！？、；：,.!?;：]/;

function normalizeLabel(raw: string): string {
  return raw.replace(/[【】[\]（）()<>《》\s]/g, "").trim();
}

/** 这个片段有没有资格当说话人标签 */
function isNameLike(label: string): boolean {
  const clean = normalizeLabel(label);
  if (clean === "") return false;
  if (!NAME_LIKE.test(clean)) return false;
  return !NOT_A_NAME.has(clean.toLowerCase());
}

export type SpeakerCandidate = {
  label: string;
  count: number;
};

export type ParseOptions = {
  /** 她的备注名（用户自己填的） */
  herName?: string | null;
  /** 用户指认的「我」是哪个标签 —— 来自「这两个人里哪个是你」的选择 */
  youAre?: string | null;
};

export type ParseResult = {
  lines: ParsedLine[];
  herCount: number;
  meCount: number;
  /** 除了你和她之外的第三方发言条数 */
  otherCount: number;
  /** 出现过的说话人标签，按首次出现顺序。界面用它渲染「哪个是你」的选择器。 */
  candidates: SpeakerCandidate[];
  /**
   * 传进来的 youAre 是否真的出现在这段对话里。
   * 为 false 说明那是上一次指认留下的、和当前内容无关的名字 —— 界面应当当作「还没选」。
   */
  youAreMatched: boolean;
  /**
   * 是否需要用户指认「哪个是你」：出现了两个以上真实昵称，但没有任何一个被认成「我」。
   * 注意这是**软**条件 —— 就算为真，只要 herCount > 0 也照样能算，只是截图里你这侧会分不清。
   */
  needsDisambiguation: boolean;
};

type Draft = { label: string; text: string };

/** 第一遍：只认「谁在说话」，不管这个人是谁。 */
function tokenize(raw: string, ctx: { herName: string | null; youAre: string | null }): Draft[] {
  const rawLines = raw.split(/\r?\n/);
  const drafts: Draft[] = [];
  let currentLabel: string | null = null;
  /**
   * 刚读到过一个抬头行。
   *
   * 这个标志解决一个具体问题：微信「合并转发」的形态是
   *   ①「Leslie 12:01」 → ②正文 → ③「Leslie 12:02」 → ④正文
   * 两条消息同属一个人。如果只看「和上一条标签是否相同」，③④ 会被併进 ①②，
   * 两条消息变成一条，后面逐句翻牌就少了一张牌。抬头行本身就是一个明确的「新消息」边界。
   */
  let pendingNewMessage = false;

  /** 开一段新消息（前缀式、抬头式用这个 —— 同一个人的连续两条是两条，不能合并） */
  const pushNew = (label: string, text: string) => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    drafts.push({ label, text: trimmed });
  };

  /** 续行：接到上一条同一说话人的消息上（微信里长按复制长消息就是这个样子） */
  const attach = (label: string, text: string) => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    const last = drafts[drafts.length - 1];
    if (last && last.label === label) {
      last.text = `${last.text}\n${trimmed}`;
      return;
    }
    pushNew(label, trimmed);
  };

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i]!.replace(/\u200b/g, "").trim();
    if (line === "") continue;
    if (NOISE.test(line)) continue;
    if (TIMESTAMP_ONLY.test(line)) continue;

    // B. 昵称 + 时间抬头
    const withTime = HEADER_WITH_TIME.exec(line);
    if (withTime && isNameLike(withTime[1]!)) {
      currentLabel = withTime[1]!.trim();
      pendingNewMessage = true;
      continue;
    }

    // B'. 裸昵称抬头 —— 只在强信号下认，否则「这还差不多」这种正文会被当成一个说话人
    if (isBareHeader(line, ctx, rawLines, i)) {
      currentLabel = line;
      pendingNewMessage = true;
      continue;
    }

    // A. `前缀：正文`
    const prefix = /^([^：:]{0,20})[：:]\s*([\s\S]*)$/.exec(line);
    if (prefix && isNameLike(prefix[1]!)) {
      currentLabel = prefix[1]!.trim();
      pushNew(currentLabel, prefix[2] ?? "");
      pendingNewMessage = false;
      continue;
    }

    // C. 续行
    if (currentLabel !== null) {
      if (pendingNewMessage) {
        pushNew(currentLabel, line);
        pendingNewMessage = false;
      } else {
        attach(currentLabel, line);
      }
      continue;
    }

    // 实在认不出来：归为「没有说话人」，不硬塞给任何人
    pushNew("", line);
  }

  return drafts;
}

/**
 * 裸昵称抬头只在这三种情况下成立：
 *  1. 就是用户声明的名字（她的备注名 / 你指认的自己）
 *  2. 是通用的「她 / 我 / 对方」这类写法
 *  3. 单独一行 + 下一行是时间戳 —— 微信「合并转发」就是这个形态，信号足够强
 * 泛化的「短、没标点」判据被刻意放弃了：中文正文太容易满足它。
 */
function isBareHeader(
  line: string,
  ctx: { herName: string | null; youAre: string | null },
  rawLines: string[],
  index: number,
): boolean {
  if (line.length > 16) return false;
  if (SENTENCE_PUNCT.test(line)) return false;
  const clean = normalizeLabel(line);
  if (clean === "") return false;
  const lower = clean.toLowerCase();

  if (ctx.youAre && normalizeLabel(ctx.youAre).toLowerCase() === lower) return true;
  if (ctx.herName && normalizeLabel(ctx.herName).toLowerCase() === lower) return true;
  if (HER_LABELS.has(lower) || ME_LABELS.has(lower)) return true;

  if (!isNameLike(line)) return false;
  for (let j = index + 1; j < Math.min(rawLines.length, index + 3); j += 1) {
    const next = rawLines[j]!.trim();
    if (next === "") continue;
    return TIMESTAMP_ONLY.test(next);
  }
  return false;
}

export function parseConversation(raw: string, options: ParseOptions = {}): ParseResult {
  const herName = options.herName?.trim() || null;
  const declaredYou = options.youAre?.trim() || null;

  const drafts = tokenize(raw, { herName, youAre: declaredYou });

  // 第二遍的前置：收集候选说话人（按首次出现顺序）
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const draft of drafts) {
    if (draft.label === "") continue;
    if (!counts.has(draft.label)) order.push(draft.label);
    counts.set(draft.label, (counts.get(draft.label) ?? 0) + 1);
  }
  const candidates: SpeakerCandidate[] = order.map((label) => ({
    label,
    count: counts.get(label) ?? 0,
  }));

  /**
   * 指认的名字必须真的出现在这段对话里才算数。
   *
   * 为什么非要卡这一道：指认结果会存在本机、跨对话复用。换了一段聊天之后，
   * 上次那个名字跟新内容毫无关系，如果照样当「我」，下面 `order.length === 2` 那条规则
   * 就会把**另外两个人一起判成「她」**——把对方的话和别人的话全算进来，
   * 而界面上看起来一切正常。宁可当作没选，让用户再点一下。
   */
  const youAreMatched =
    declaredYou !== null &&
    order.some((label) => normalizeLabel(label).toLowerCase() === normalizeLabel(declaredYou).toLowerCase());
  const youAre = youAreMatched ? declaredYou : null;

  const roleOf = (label: string): Speaker => {
    if (label === "") return "unknown";
    const clean = normalizeLabel(label);
    const lower = clean.toLowerCase();

    if (youAre && normalizeLabel(youAre).toLowerCase() === lower) return "me";
    if (herName && normalizeLabel(herName).toLowerCase() === lower) return "her";
    if (ME_LABELS.has(lower)) return "me";
    if (HER_LABELS.has(lower)) return "her";
    // 用户已经指认了自己，而且整段只出现过两个说话人 —— 另一个就是她
    if (youAre && order.length === 2) return "her";
    return "unknown";
  };

  const lines: ParsedLine[] = drafts.map((draft, index) => ({
    index,
    speaker: roleOf(draft.label),
    label: draft.label,
    text: draft.text,
  }));

  const herCount = lines.filter((l) => l.speaker === "her").length;
  const meCount = lines.filter((l) => l.speaker === "me").length;

  return {
    lines,
    herCount,
    meCount,
    otherCount: lines.length - herCount - meCount,
    candidates,
    youAreMatched,
    needsDisambiguation: candidates.length >= 2 && meCount === 0,
  };
}

/**
 * 挑出真正要翻牌的句子。
 *
 * 优先覆盖首尾：冲突通常是越聊越升级，但开头往往埋着起因，只取尾部会丢掉「为什么生气」。
 * 所以超出上限时做**均匀抽样**而不是直接截尾。同时按 ANALYZE_MAX_ANALYZED_LINES 截断，
 * 保证一次分析的耗时和成本可控。
 */
export function selectFocusLines(lines: ParsedLine[], maxAnalyzed: number): ParsedLine[] {
  const hers = lines.filter((l) => l.speaker === "her");
  if (hers.length <= maxAnalyzed) return hers;

  const picked: ParsedLine[] = [];
  const step = hers.length / maxAnalyzed;
  for (let i = 0; i < maxAnalyzed; i += 1) {
    const target = hers[Math.floor(i * step + step / 2)];
    if (target) picked.push(target);
  }
  return picked.length > 0 ? picked : hers.slice(-maxAnalyzed);
}
