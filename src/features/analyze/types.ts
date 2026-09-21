/**
 * 领域模型。
 *
 * 这里刻意不 import 任何 Next.js / 数据库 / SDK 的东西 —— 纯类型，
 * 让服务层与界面层共用同一份契约，改一处两边同时报错。
 */

/** 说话人。her = 被解读的那一方，me = 你，unknown = 没写前缀的裸行 */
export type Speaker = "her" | "me" | "unknown";

export type ParsedLine = {
  /** 在原始文本里的行序（从 0 开始），翻牌时用于对齐原始顺序 */
  index: number;
  speaker: Speaker;
  /** 原文里的说话人前缀，如「她」「我」「宝儿」 */
  label: string;
  text: string;
};

/** 一个 Choice / Score 判断的标准结果形状 */
export type Judgment = {
  /** 命中的选项 key */
  key: string;
  /** 面向用户的中文标签 */
  label: string;
  /** 全量概率分布，key → 概率，和为 1 */
  probabilities: Record<string, number>;
  /** 0..1，分布集中度。低置信度意味着「几个选项都说得通」 */
  confidence: number;
};

/** Score 的结果，额外带一个取整后的等级下标 —— 界面直接拿它取色和取文案 */
export type ScoreJudgment = Judgment & { level: number };

export type LineAnalysis = {
  /** 对应 ParsedLine.index */
  index: number;
  text: string;
  /** 这一句是否没算出来（Jev 请求失败或返回不完整）。为 true 时界面只显示一句提示，不展示数字。 */
  failed?: boolean;
  /** Noul：这句是否含有值得解读的言外之意 */
  worthReading: number;
  /** Noul：是否需要反着理解（反话 / 阴阳 / 客套） */
  isIronic: number;
  /** Choice：真实意图 */
  intent: Judgment;
  /** Choice：她此刻需要什么 */
  need: Judgment;
  /** Score：危险等级 */
  danger: ScoreJudgment;
  /** Choice：建议动作 */
  move: Judgment;
};

export type ConversationJudgment = {
  /** Choice：整段关系的定性 */
  verdict: Judgment;
  /** Score：整段是越聊越好还是越聊越危险 */
  trend: ScoreJudgment;
  /** Choice：现在最该做的一件事 */
  priority: Judgment;
};

export type AnalysisUsage = {
  inputTokens: number;
  outputTokens: number;
  /** 实际发起的 Jev 请求数（1 + 被分析的句数） */
  requests: number;
  elapsedMs: number;
};

export type AnalysisSnapshot = {
  version: 1;
  lines: ParsedLine[];
  /** 只包含「她」说的话，也就是真正被翻牌的那些 */
  analyzed: LineAnalysis[];
  conversation: ConversationJudgment;
  usage: AnalysisUsage;
  demo: boolean;
};

export type AnalysisInput = {
  raw: string;
  /** 她的备注名 */
  herName: string | null;
  /**
   * 用户指认的「我」在原文里的标签（来自「这两个人里哪个是你」的选择）。
   * 粘贴的记录里说话人常常是两个真实昵称，没有它就分不清该算谁说的话。
   */
  youAre: string | null;
  relation: string | null;
  extra: string | null;
};

export type AnalysisRecord = {
  id: string;
  createdAt: number;
  title: string;
  shareSlug: string | null;
  input: AnalysisInput;
  snapshot: AnalysisSnapshot;
  peakDanger: number;
  herLines: number;
};

export type AnalysisSummary = {
  id: string;
  createdAt: number;
  title: string;
  herName: string | null;
  relation: string | null;
  herLines: number;
  peakDanger: number;
  shareSlug: string | null;
};

export type RelationshipProfile = {
  herName: string | null;
  relation: string | null;
  extra: string | null;
  updatedAt: number;
};
