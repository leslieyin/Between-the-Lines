"use client";

/**
 * 微信聊天截图生成（纯前端 canvas）。
 *
 * 为什么坚持在浏览器里画而不是服务端渲染：
 *  1. 隐私 —— 聊天记录本来就不该为了生成一张图再往服务器发一次。
 *  2. 成本 —— 服务端渲染一次要跑 headless 浏览器，Workers 上根本跑不了。
 *  3. 即时 —— 点一下就有，不用等。
 *
 * 画的是一张「聊天记录 + 每句下面附一条解读」的长图。刻意保留微信原本的绿白气泡配色，
 * 因为这张图的价值在于「看起来像日常截图」，而不是看起来像一份报告。
 * 这一段只在不破坏微信观感的前提下做精致化：间距、字体层级、解读卡留白、危险色竖条。
 */

import { dangerMeta, emotionColor } from "@/features/analyze/presentation";
import type { LineAnalysis, ParsedLine } from "@/features/analyze/types";

const WIDTH = 750;
const PAD = 24;
const BUBBLE_MAX = Math.round(WIDTH * 0.68);
const FONT_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';

const COLORS = {
  chatBg: "#ededed",
  topBar: "#f7f7f7",
  line: "#dcdcdc",
  herBubble: "#ffffff",
  meBubble: "#95ec69",
  text: "#191919",
  muted: "#9a9a9a",
  card: "#ffffff",
  cardBorder: "#ececec",
  gold: "#b08b3e",
  foot: "#f7f7f7",
  dayPill: "#c9c9c9",
};

/**
 * 解读卡里的每一行都带上「这是哪一类」—— 长图是白底的，
 * 只能靠颜色区分轻重，所以行必须自带类别，画的时候才知道该上什么色。
 */
type NoteKind = "flag" | "intent" | "need" | "move";

type NoteRow = { text: string; kind: NoteKind };

type Item =
  | { kind: "day"; label: string; height: number }
  | { kind: "msg"; speaker: ParsedLine["speaker"]; text: string; height: number; rows: string[] }
  | { kind: "note"; analysis: LineAnalysis; height: number; rows: NoteRow[] };

function font(size: number, weight: "400" | "500" | "600" = "400"): string {
  return `${weight} ${size}px ${FONT_STACK}`;
}

function measure(ctx: CanvasRenderingContext2D, text: string, size: number, weight: "400" | "500" | "600" = "400"): number {
  ctx.font = font(size, weight);
  return ctx.measureText(text).width;
}

/** 把一段文字按最大宽度折成若干行。canvas 没有自动换行，必须自己算。 */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number,
  weight: "400" | "500" | "600" = "400",
): string[] {
  ctx.font = font(size, weight);
  const rows: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      rows.push("");
      continue;
    }
    let current = "";
    for (const char of paragraph) {
      const candidate = current + char;
      if (ctx.measureText(candidate).width > maxWidth && current !== "") {
        rows.push(current);
        current = char;
      } else {
        current = candidate;
      }
    }
    if (current !== "") rows.push(current);
  }
  return rows.length > 0 ? rows : [""];
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** 轻量阴影，让气泡和卡片从灰底里浮起来一点点（微信本身很平，这里只点到为止）。 */
function softShadow(ctx: CanvasRenderingContext2D, blur = 8, alpha = 0.06) {
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = 1;
}

function clearShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

const MSG_LINE_HEIGHT = 27;
const MSG_FONT = 16;
const MSG_GAP = 26; // 气泡与下一行之间的留白
const CARD_LINE_HEIGHT = 23;

type ShotInput = {
  herName: string;
  lines: ParsedLine[];
  analyzed: LineAnalysis[];
  /** 最多画多少句（防止长图长到没法看） */
  maxMessages?: number;
};

export async function renderChatShot(input: ShotInput): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("这个浏览器不支持 canvas，直接截屏也一样。");
  ctx.imageSmoothingEnabled = true;

  const analysisByIndex = new Map(input.analyzed.map((a) => [a.index, a]));
  const transcript = input.lines.slice(-(input.maxMessages ?? 40));

  // ── 第一遍：排版，算出每一块的高度和总高 ──────────────────────────────
  const items: Item[] = [{ kind: "day", label: "今天", height: 50 }];

  for (const line of transcript) {
    if (line.text.trim() === "") continue;
    const rows = wrap(ctx, line.text, BUBBLE_MAX - 28, MSG_FONT);
    items.push({
      kind: "msg",
      speaker: line.speaker,
      text: line.text,
      rows,
      height: rows.length * MSG_LINE_HEIGHT + 20 + MSG_GAP,
    });

    const analysis = analysisByIndex.get(line.index);
    if (analysis && !analysis.failed) {
      const wrapped: NoteRow[] = [];
      const push = (text: string, kind: NoteKind, width: number, weight: "400" | "500" | "600" = "400") => {
        for (const row of wrap(ctx, text, width, 14, weight)) {
          wrapped.push({ text: row, kind });
        }
      };

      if (analysis.isIronic >= 0.5) {
        push(`⚑ 这句要反着听（${Math.round(analysis.isIronic * 100)}%）`, "flag", BUBBLE_MAX - 36, "600");
      }
      // 情绪类型：单独上色 + 左侧色点，让人一眼扫出「她这句是什么情绪」
      push(
        `她真正想说的：${analysis.intent.label}（${Math.round(
          (analysis.intent.probabilities[analysis.intent.key] ?? 0) * 100,
        )}%）`,
        "intent",
        BUBBLE_MAX - 14, // 左边给色点让出 14px，所以可写宽度比正文窄一点
        "600",
      );
      push(`她此刻需要：${analysis.need.label}`, "need", BUBBLE_MAX - 36);
      push(`建议动作：${analysis.move.label}`, "move", BUBBLE_MAX - 36, "600");

      items.push({
        kind: "note",
        analysis,
        rows: wrapped,
        height: wrapped.length * CARD_LINE_HEIGHT + 56,
      });
    }
  }

  const topBarHeight = 108;
  const footHeight = 84;
  const bodyHeight = items.reduce((sum, item) => sum + item.height, 0) + 20;
  const height = topBarHeight + bodyHeight + footHeight;

  const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  canvas.width = WIDTH * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  // ── 第二遍：真正画 ──────────────────────────────────────────────────
  ctx.fillStyle = COLORS.chatBg;
  ctx.fillRect(0, 0, WIDTH, height);

  // 顶栏
  ctx.fillStyle = COLORS.topBar;
  ctx.fillRect(0, 0, WIDTH, topBarHeight);
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, topBarHeight - 0.5);
  ctx.lineTo(WIDTH, topBarHeight - 0.5);
  ctx.stroke();

  // 返回箭头
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(PAD + 10, 36);
  ctx.lineTo(PAD, 36);
  ctx.lineTo(PAD + 7, 29);
  ctx.stroke();

  // 标题
  ctx.fillStyle = COLORS.text;
  ctx.font = font(19, "600");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(input.herName || "她", WIDTH / 2, 33);

  // 副标题（金色短字，点明这是解读版截图）
  ctx.fillStyle = COLORS.gold;
  ctx.font = font(12, "600");
  ctx.fillText("懂你 · 逐句解读", WIDTH / 2, 72);

  // 消息与解读
  ctx.textBaseline = "alphabetic";
  let y = topBarHeight + 10;

  for (const item of items) {
    if (item.kind === "day") {
      // 微信风格的居中日期小灰条
      ctx.font = font(12);
      const w = measure(ctx, item.label, 12) + 28;
      ctx.fillStyle = COLORS.dayPill;
      roundRect(ctx, (WIDTH - w) / 2, y, w, 26, 13);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText(item.label, WIDTH / 2, y + 17);
      y += item.height;
      continue;
    }

    if (item.kind === "msg") {
      const isMe = item.speaker !== "her";
      const bubbleW = Math.min(BUBBLE_MAX, Math.max(...item.rows.map((r) => measure(ctx, r, MSG_FONT))) + 28);
      const bubbleH = item.rows.length * MSG_LINE_HEIGHT + 20;
      const x = isMe ? WIDTH - PAD - bubbleW : PAD;

      // 说话人小标签
      ctx.fillStyle = COLORS.muted;
      ctx.font = font(11);
      ctx.textAlign = isMe ? "right" : "left";
      ctx.fillText(isMe ? "我" : input.herName || "她", isMe ? WIDTH - PAD : PAD, y + 6);

      softShadow(ctx, 6, 0.05);
      ctx.fillStyle = isMe ? COLORS.meBubble : COLORS.herBubble;
      roundRect(ctx, x, y + 14, bubbleW, bubbleH, 10);
      ctx.fill();
      clearShadow(ctx);

      // 对方气泡加一道极淡描边，避免纯白融进灰底
      if (!isMe) {
        ctx.strokeStyle = "rgba(0,0,0,0.04)";
        ctx.lineWidth = 1;
        roundRect(ctx, x + 0.5, y + 14.5, bubbleW - 1, bubbleH - 1, 10);
        ctx.stroke();
      }

      ctx.fillStyle = COLORS.text;
      ctx.font = font(MSG_FONT);
      ctx.textAlign = "left";
      item.rows.forEach((row, i) => {
        ctx.fillText(row, x + 14, y + 14 + 20 + i * MSG_LINE_HEIGHT);
      });
      y += item.height;
      continue;
    }

    // 解读卡
    const meta = dangerMeta(item.analysis.danger.level);
    const cardX = PAD;
    const cardW = BUBBLE_MAX + 40;
    const cardH = item.height - 12;

    softShadow(ctx, 8, 0.04);
    ctx.fillStyle = COLORS.card;
    roundRect(ctx, cardX, y + 6, cardW, cardH, 12);
    ctx.fill();
    clearShadow(ctx);

    ctx.strokeStyle = COLORS.cardBorder;
    ctx.lineWidth = 1;
    roundRect(ctx, cardX + 0.5, y + 6.5, cardW - 1, cardH - 1, 12);
    ctx.stroke();

    // 左侧危险等级竖条：圆角挖空式（只画左端一小段，不超出卡片圆角）
    ctx.fillStyle = meta.shot;
    roundRect(ctx, cardX, y + 6, 5, cardH, 3);
    ctx.fill();

    // 卡头：左标题 + 右危险标签
    ctx.fillStyle = COLORS.muted;
    ctx.font = font(11, "600");
    ctx.textAlign = "left";
    ctx.fillText("懂你 · AI 解读", cardX + 18, y + 28);

    ctx.fillStyle = meta.shot;
    ctx.textAlign = "right";
    ctx.font = font(11, "600");
    ctx.fillText(meta.short, cardX + cardW - 18, y + 28);

    // 正文：情绪类型上色 + 色点，建议动作走金色，其余保持正文黑
    const emotion = emotionColor(item.analysis.intent.key).shot;
    const firstIntent = item.rows.findIndex((r) => r.kind === "intent");

    ctx.textAlign = "left";
    item.rows.forEach((row, i) => {
      const baseline = y + 54 + i * CARD_LINE_HEIGHT;

      if (row.kind === "intent") {
        ctx.fillStyle = emotion;
        ctx.font = font(14, "600");
        if (i === firstIntent) {
          ctx.beginPath();
          ctx.arc(cardX + 21, baseline - 5, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillText(row.text, cardX + 32, baseline);
        return;
      }

      if (row.kind === "move") {
        ctx.fillStyle = COLORS.gold;
        ctx.font = font(14, "600");
        ctx.fillText(row.text, cardX + 18, baseline);
        return;
      }

      if (row.kind === "flag") {
        ctx.fillStyle = meta.shot;
        ctx.font = font(14, "600");
        ctx.fillText(row.text, cardX + 18, baseline);
        return;
      }

      ctx.fillStyle = COLORS.text;
      ctx.font = font(14, "400");
      ctx.fillText(row.text, cardX + 18, baseline);
    });

    y += item.height;
  }

  // 页脚
  const footY = height - footHeight;
  ctx.fillStyle = COLORS.foot;
  ctx.fillRect(0, footY, WIDTH, footHeight);
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, footY + 0.5);
  ctx.lineTo(WIDTH, footY + 0.5);
  ctx.stroke();

  ctx.fillStyle = COLORS.muted;
  ctx.font = font(12);
  ctx.textAlign = "center";
  ctx.fillText("结论由 Jev 模型算出，不是话术 · 懂你", WIDTH / 2, footY + 32);
  ctx.fillStyle = COLORS.gold;
  ctx.font = font(11, "600");
  ctx.fillText("每句话，都值得算一遍", WIDTH / 2, footY + 54);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图没存下来，直接截屏也一样。"));
    }, "image/png");
  });
}
