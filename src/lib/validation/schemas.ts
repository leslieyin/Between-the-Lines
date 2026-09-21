/**
 * 边界校验：所有来自客户端的数据都在这里过一遍，绝不信任前端。
 *
 * 分两层：
 *  1. zod 的静态硬上限 —— 防御性兜底，挡住明显离谱的输入（超大字符串、超长字段）。
 *  2. 配置里的可变上限 —— 真正生效的业务限制（ANALYZE_MAX_CHARS 等），
 *     单独在服务里检查，这样报错文案能带上具体数字，用户知道要删多少。
 */

import { z } from "zod";

/**
 * 可选文本：空字符串一律收敛成 null，避免「填了又清空」产生一堆 "" 污染数据库。
 * 注意顺序 —— 先 .optional().nullable() 再 .transform()。反过来在部分 zod 版本上
 * .transform() 之后拿不到 .optional()，会在类型层面直接报错。
 */
const optionalText = (max: number) =>
  z
    .string()
    .max(max, `内容太长了（最多 ${max} 个字）`)
    .optional()
    .nullable()
    .transform((v) => {
      const trimmed = (v ?? "").trim();
      return trimmed === "" ? null : trimmed;
    });

export const analyzeInputSchema = z.object({
  raw: z
    .string()
    .min(2, "内容太短了，至少贴一句完整的对话。")
    .max(20_000, "内容太长了，请只贴这一段相关的对话。")
    .transform((v) => v.trim()),
  herName: optionalText(24),
  /** 「这两个人里哪个是你」选中的标签原文 */
  youAre: optionalText(24),
  relation: optionalText(120),
  extra: optionalText(300),
});

export type AnalyzeInputDto = z.infer<typeof analyzeInputSchema>;

export const profileSchema = z.object({
  herName: optionalText(24),
  relation: optionalText(120),
  extra: optionalText(300),
});

export const shareSchema = z.object({
  /** 是否公开 —— 目前只支持 true，留字段是为了以后能「关掉分享」而不改接口形状 */
  public: z.boolean().optional(),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
