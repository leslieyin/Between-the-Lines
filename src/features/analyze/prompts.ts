/**
 * Jev 提问设计 —— 这个产品最核心的部分。
 *
 * 设计要点（对应 typesafe-ai 的建模方式）：
 *  1. 「选项提前定死，模型只负责打分」。所有可能的答案都由这里枚举，模型只输出概率分布，
 *     所以它**编不出一个不存在的结论**，也就不会像自由生成的模型那样一本正经地胡说。
 *  2. 每个问题只问一件事。维度独立就让它们分开问，不要合成一个「综合评分」。
 *     独立问题在同一个请求里并行推理，互相看不到对方的答案，可以放心一起发。
 *  3. 「她」这句话的判断必须带上上下文：单看一句「你最好是」什么都判断不出来，
 *     所以每个问题都把 target 单句 + 整段 chat + 关系背景一起给模型。
 *  4. Score 只用于真正有序的维度（危险程度、走势），且每级描述必须能独立读懂，
 *     不能写成「较低/中等/较高」这种离开标题就没意义的词。
 *  5. Choice 一律保留一个 no-match 出口（`unclear` / `nothing_major`），
 *     否则模型会被迫在都不合适的选项里挑一个，输出一个看起来很确定的错误答案。
 */

import type { ChoiceQuestion, NoulQuestion, Question, ScoreQuestion } from "@/lib/typesafe/client";
import type { ParsedLine } from "./types";

// ── 选项表（模型面向的 criteria + 界面面向的中文标签，一处定义两处用）──────────

type OptionTable<K extends string> = Record<K, { criteria: string; label: string }>;

/** 危险等级的四个台阶。界面上同时用颜色和文案表达，不依赖单一维度。 */
export const DANGER_LEVELS = [
  "完全安全，随口一问，字面理解就行",
  "有点情绪，需要注意措辞，但没到冲突的程度",
  "明显不满，需要正面回应，回避会让她更生气",
  "高危，处理不当会立刻升级为争吵或冷战",
] as const;

export const TREND_LEVELS = [
  "越聊越好，气氛明显在缓和",
  "略有好转，结尾比开头轻松",
  "基本平着走，没变好也没变坏",
  "越聊越紧张，后半段压力在上升",
  "越聊越危险，收尾时已经不对劲了",
] as const;

/** 真实意图 */
export const INTENT_OPTIONS: OptionTable<string> = {
  seeking_reassurance: {
    criteria: "想确认你还在乎她、还在意这段关系，重点在态度而不是事情本身",
    label: "想确认你还在乎她",
  },
  expressing_dissatisfaction: {
    criteria: "在表达不满，希望你察觉到并且主动认错，而不是等她挑明",
    label: "在表达不满",
  },
  asking_for_action: {
    criteria: "想要一个具体的行动或安排，不想再讨论，要的是结果",
    label: "想要你去做，不是再说",
  },
  testing: {
    criteria: "在试探你记不记得、在不在意、会不会敷衍，答案对不对是次要的",
    label: "在试探你",
  },
  wanting_comfort: {
    criteria: "想要被哄、被安慰、被重视，情绪需要一个出口",
    label: "想要被哄",
  },
  setting_boundary: {
    criteria: "在划底线，提醒你某件事不能再发生，语气通常偏冷静",
    label: "在划底线",
  },
  smalltalk: {
    criteria: "就是随口聊，没有额外含义，正常接话即可",
    label: "随口聊，没别的意思",
  },
  unclear: {
    criteria: "信息不足以判断真实意图，任何解读都是猜",
    label: "信息不够，说不准",
  },
};

/** 此刻的需求 */
export const NEED_OPTIONS: OptionTable<string> = {
  action_now: {
    criteria: "一个立刻能落实的具体方案：时间、地点、由你来做，越细越好",
    label: "一个能立刻落实的方案",
  },
  be_seen: {
    criteria: "被看见、被理解。你需要说出你懂她为什么在意这件事，而不只是解决问题",
    label: "被理解",
  },
  apology: {
    criteria: "一句明确的道歉和认错，不要解释、不要找理由、不要反过来讲道理",
    label: "一句道歉",
  },
  reassurance: {
    criteria: "一个明确的态度或承诺，让她安心，重点是确定性不是字数",
    label: "一个明确的态度",
  },
  companionship: {
    criteria: "你的时间和陪伴本身，先别分析问题、别讲道理",
    label: "要你的时间",
  },
  space: {
    criteria: "一点独处的空间，别追着问、别连发消息",
    label: "一点空间",
  },
  nothing: {
    criteria: "什么都不需要，正常聊下去就行，过度解读反而会出问题",
    label: "什么都不需要",
  },
};

/** 建议动作 */
export const MOVE_OPTIONS: OptionTable<string> = {
  act_concretely: {
    criteria: "直接给出具体方案并落实：说清谁做什么、什么时候做，然后真的去做",
    label: "直接给方案，然后去做",
  },
  apologize_plainly: {
    criteria: "先认错，不解释、不找理由、不对比谁更过分",
    label: "先认错，别解释",
  },
  name_feeling: {
    criteria: "先把她可能的感受说出来，确认你懂了，再谈事情",
    label: "先说出她的感受",
  },
  ask_directly: {
    criteria: "直接问清楚她在意的是哪一点，态度要诚恳而不是盘问",
    label: "直接问清楚",
  },
  hold_emotion: {
    criteria: "先接住情绪，不辩解、不反驳，等情绪落地再说事",
    label: "先接住情绪",
  },
  give_space: {
    criteria: "给她一点空间，别追问、别连发，等她自己开口",
    label: "给她点空间",
  },
  keep_chatting: {
    criteria: "顺着正常聊下去，不要过度解读、不要突然郑重其事",
    label: "正常聊下去",
  },
};

/** 整段关系定性 */
export const VERDICT_OPTIONS: OptionTable<string> = {
  fine: { criteria: "没什么问题，就是正常相处里的日常对话", label: "没什么问题" },
  needs_attention: {
    criteria: "有一些信号值得你注意，但整体还好，及时回应就能过去",
    label: "有些信号要注意",
  },
  needs_repair: {
    criteria: "已经有明显裂痕，需要你主动修复，拖下去会变严重",
    label: "需要你主动修复",
  },
  cold_war: {
    criteria: "已经进入冷处理或边缘状态，再没有动作会更僵",
    label: "已经在凉了",
  },
  escalating: {
    criteria: "正在恶化，语气一步步升级，随时可能爆发",
    label: "正在恶化",
  },
};

/** 最该做的一件事 */
export const PRIORITY_OPTIONS: OptionTable<string> = {
  apologize_specifically: {
    criteria: "为具体的一件事道歉，说清你错在哪，而不是笼统地说对不起",
    label: "为具体的事道歉",
  },
  make_a_plan: {
    criteria: "提出一个具体可执行的安排，并且由你来做，不要让她安排",
    label: "给一个具体安排",
  },
  have_a_talk: {
    criteria: "约个时间认真聊一次，把话说清楚，前提是你先听完她",
    label: "找时间认真聊一次",
  },
  show_up: {
    criteria: "用行动出现：见面、陪她、把答应的事情办掉",
    label: "用行动出现",
  },
  give_time: {
    criteria: "先给彼此一点时间，别急着解释和挽回",
    label: "先给点时间",
  },
  nothing_major: {
    criteria: "不需要特别做什么，保持正常相处就好",
    label: "不用特意做什么",
  },
};

/** 把选项表转成 Choice 问题需要的 criteria（key → 描述） */
function criteriaOf(table: OptionTable<string>): Record<string, string> {
  return Object.fromEntries(Object.entries(table).map(([key, v]) => [key, v.criteria]));
}

// ── 输入状态 ────────────────────────────────────────────────────────────────

export type AnalyzeState = {
  relationship: {
    her_name: string | null;
    relation: string | null;
    background: string | null;
  };
  /** 整段对话，逐条编号。who 是「她」或「我」或「其他人」。 */
  chat: { n: number; who: string; text: string }[];
};

export function buildState(
  relationship: AnalyzeState["relationship"],
  lines: ParsedLine[],
): AnalyzeState {
  return {
    relationship,
    chat: lines.map((line) => ({
      n: line.index,
      who: line.speaker === "her" ? "她" : line.speaker === "me" ? "我" : "其他人",
      text: line.text,
    })),
  };
}

type FocusLine = Pick<ParsedLine, "index" | "text">;

/** 每个问题共用的 target 数据块，让模型始终知道「现在在判哪一句」。 */
function targetOf(line: FocusLine) {
  return { n: line.index, who: "她", text: line.text };
}

// ── 单句问题集 ──────────────────────────────────────────────────────────────

/**
 * 为一批 focus 句生成问题。
 *
 * 为什么成批而不是一次一句：Jev 的每个请求可以并行问多个独立问题，
 * 把同一个 state（整段对话）复用给多句判断，能显著减少请求数、token 和总耗时 —— 这点在
 * Cloudflare Workers 的 CPU 预算下尤其重要。代价是单句判断会稍微「挤」一点，
 * 所以批大小默认只放 4 句，而不是把 16 句塞进一个请求。
 */
export function buildLineQuestions(focus: FocusLine[]): Record<string, Question> {
  const questions: Record<string, Question> = {};

  for (const line of focus) {
    const key = `l${line.index}`;

    questions[`${key}_overtone`] = {
      type: "noul",
      instructions: {
        target: targetOf(line),
        question:
          "`target` 这句话除了字面意思，是否还含有需要解读的言外之意、情绪或潜台词？结合 `chat` 里前后的对话判断。",
      },
      criteria: {
        true: "有明显言外之意、情绪或试探，只看字面会漏掉信息",
        false: "就是字面意思，纯信息或寒暄",
      },
    } satisfies NoulQuestion;

    questions[`${key}_flip`] = {
      type: "noul",
      instructions: {
        target: targetOf(line),
        question:
          "`target` 这句话是否需要反着理解？例如嘴上说「没事」其实有事、说「随便」其实心里有偏好、表面在夸人其实是不满。",
      },
      criteria: {
        true: "需要反着理解，字面意思和真实意思相反或打折",
        false: "不需要反着理解，怎么说的就是怎么想的",
      },
    } satisfies NoulQuestion;

    questions[`${key}_intent`] = {
      type: "choice",
      instructions: {
        target: targetOf(line),
        question: "`target` 这句话真正想表达的是什么？",
      },
      criteria: criteriaOf(INTENT_OPTIONS),
    } satisfies ChoiceQuestion;

    questions[`${key}_need`] = {
      type: "choice",
      instructions: {
        target: targetOf(line),
        question: "说完这句话之后，她此刻最需要的是什么？",
      },
      criteria: criteriaOf(NEED_OPTIONS),
    } satisfies ChoiceQuestion;

    questions[`${key}_danger`] = {
      type: "score",
      instructions: {
        target: targetOf(line),
        question:
          "`target` 这句话的危险程度有多高？危险指「如果回得不对，关系会受损」的程度，不是指语气凶不凶。",
      },
      criteria: [...DANGER_LEVELS],
    } satisfies ScoreQuestion;

    questions[`${key}_move`] = {
      type: "choice",
      instructions: {
        target: targetOf(line),
        question: "现在最合适的回应方式是哪一种？",
      },
      criteria: criteriaOf(MOVE_OPTIONS),
    } satisfies ChoiceQuestion;
  }

  return questions;
}

/**
 * 必须存在、缺一个就说明这一批答案不可用的键。
 * 同时带上期望的答案类型 —— 收到类型对不上的答案等同于没收到，宁可标成「没算出来」，
 * 也不要把一个 Choice 的分布硬塞进 Score 的位置渲染出一个假的危险等级。
 */
export function requiredLineKeys(
  line: FocusLine,
): { key: string; type: "noul" | "choice" | "score" }[] {
  const key = `l${line.index}`;
  return [
    { key: `${key}_overtone`, type: "noul" },
    { key: `${key}_flip`, type: "noul" },
    { key: `${key}_intent`, type: "choice" },
    { key: `${key}_need`, type: "choice" },
    { key: `${key}_danger`, type: "score" },
    { key: `${key}_move`, type: "choice" },
  ];
}

/** 整段判断额外的辅助数据：逐句危险等级。让「走势」有据可依，而不是模型凭印象说一句。 */
export function withLineDanger(
  state: AnalyzeState,
  dangers: { n: number; danger: number }[],
): AnalyzeState & { line_danger: { n: number; danger: number }[] } {
  return { ...state, line_danger: dangers };
}

// ── 整段问题集 ──────────────────────────────────────────────────────────────

export function buildConversationQuestions(): Record<string, Question> {
  return {
    verdict: {
      type: "choice",
      instructions:
        "把 `chat` 整段对话作为整体来看，这段关系现在处于什么状态？不要只看某一句。",
      criteria: criteriaOf(VERDICT_OPTIONS),
    } satisfies ChoiceQuestion,
    trend: {
      type: "score",
      instructions: "从 `chat` 的开头到结尾，气氛是往好的方向走还是往危险的方向走？",
      criteria: [...TREND_LEVELS],
    } satisfies ScoreQuestion,
    priority: {
      type: "choice",
      instructions: "如果今天只能做一件事来改善局面，应该做哪一件？",
      criteria: criteriaOf(PRIORITY_OPTIONS),
    } satisfies ChoiceQuestion,
  };
}

export const CONVERSATION_KEYS = ["verdict", "trend", "priority"] as const;

// ── 界面用的中文标签表 ──────────────────────────────────────────────────────
// 和上面的 criteria 同源，改选项只需要改一处，界面和模型不会走偏。

function labelOf(table: OptionTable<string>): Record<string, string> {
  return Object.fromEntries(Object.entries(table).map(([key, v]) => [key, v.label]));
}

export const LABELS = {
  intent: labelOf(INTENT_OPTIONS),
  need: labelOf(NEED_OPTIONS),
  move: labelOf(MOVE_OPTIONS),
  verdict: labelOf(VERDICT_OPTIONS),
  priority: labelOf(PRIORITY_OPTIONS),
} as const;

/** 各维度解析失败时的兜底选项 —— 一律选「不确定」那一档，绝不给出虚假的安心结论。 */
export const FALLBACK_KEYS = {
  intent: "unclear",
  need: "nothing",
  move: "keep_chatting",
  verdict: "needs_attention",
  priority: "nothing_major",
} as const;
