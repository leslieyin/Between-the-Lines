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
 */

import { dangerMeta } from "@/features/analyze/presentation";
import type { LineAnalysis, ParsedLine } from "@/features/analyze/types";

const WIDTH = 750;
const PAD = 26;
const BUBBLE_MAX = Math.round(WIDTH * 0.66);
const FONT_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';

const COLORS = {
  chatBg: "#ededed",
  topBar: "#f7f7f7",
  line: "#dcdcdc",
  herBubble: "#ffffff",
  meBubble: "#95ec69",
  text: "#191919",
  muted: "#8b8b8b",
  card: "#ffffff",
  gold: "#b08b3e",
  foot: "#f7f7f7",
};

type Item =
  | { kind: "day"; label: string; height: number }
  | { kind: "msg"; speaker: ParsedLine["speaker"]; text: string; height: number; rows: string[] }
  | { kind: "note"; analysis: LineAnalysis; height: number; rows: string[] };

function font(size: number, weight: "400" | "500" | "600" = "400"): string {
  return `${weight} ${size}px ${FONT_STACK}`;
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

const MSG_LINE_HEIGHT = 26;
const MSG_FONT = 16;

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

  const analysisByIndex = new Map(input.analyzed.map((a) => [a.index, a]));
  const transcript = input.lines.slice(-(input.maxMessages ?? 22));

  // ── 第一遍：排版，算出每一块的高度和总高 ──────────────────────────────
  const items: Item[] = [{ kind: "day", label: "今天", height: 44 }];

  for (const line of transcript) {
    if (line.text.trim() === "") continue;
    const rows = wrap(ctx, line.text, BUBBLE_MAX - 26, MSG_FONT);
    items.push({
      kind: "msg",
      speaker: line.speaker,
      text: line.text,
      rows,
      height: rows.length * MSG_LINE_HEIGHT + 20 + 10,
    });

    const analysis = analysisByIndex.get(line.index);
    if (analysis && !analysis.failed) {
      const noteRows = [
        `她真正想说的：${analysis.intent.label}（${Math.round(
          (analysis.intent.probabilities[analysis.intent.key] ?? 0) * 100,
        )}%）`,
        `她此刻需要：${analysis.need.label}`,
        `建议动作：${analysis.move.label}`,
      ];
      const wrapped = noteRows.flatMap((row) => wrap(ctx, row, BUBBLE_MAX - 40, 14));
      if (analysis.isIronic >= 0.5) {
        wrapped.unshift(
          ...wrap(ctx, `⚑ 这句要反着听（${Math.round(analysis.isIronic * 100)}%）`, BUBBLE_MAX - 40, 14, "600"),
        );
      }
      items.push({
        kind: "note",
        analysis,
        rows: wrapped,
        height: wrapped.length * 22 + 34 + 14,
      });
    }
  }

  const topBarHeight = 104;
  const footHeight = 78;
  const bodyHeight = items.reduce((sum, item) => sum + item.height, 0) + 24;
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

  ctx.fillStyle = COLORS.text;
  ctx.font = font(20, "500");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(input.herName || "她", WIDTH / 2, 34);

  ctx.fillStyle = COLORS.muted;
  ctx.font = font(12);
  ctx.textAlign = "left";
  ctx.fillText("‹ 微信", PAD, 34);
  ctx.textAlign = "right";
  ctx.fillText("⋯", WIDTH - PAD, 34);

  ctx.fillStyle = COLORS.gold;
  ctx.font = font(12, "600");
  ctx.textAlign = "center";
  ctx.fillText("话外音 · 逐句解读", WIDTH / 2, 74);

  // 消息与解读
  let y = topBarHeight + 12;
  ctx.textBaseline = "alphabetic";

  for (const item of items) {
    if (item.kind === "day") {
      ctx.fillStyle = COLORS.muted;
      ctx.font = font(12);
      ctx.textAlign = "center";
      ctx.fillText(item.label, WIDTH / 2, y + 22);
      y += item.height;
      continue;
    }

    if (item.kind === "msg") {
      // 除她以外的都画到右边。没指认「我是谁」时对方的发言会落在 unknown，
      // 但这张图是一对一聊天截图，把它画到左边会和她的气泡混成一片。
      const isMe = item.speaker !== "her";
      const bubbleW = Math.min(BUBBLE_MAX, Math.max(...item.rows.map((r) => measure(ctx, r, MSG_FONT))) + 26);
      const bubbleH = item.rows.length * MSG_LINE_HEIGHT + 20;
      const x = isMe ? WIDTH - PAD - bubbleW : PAD;

      ctx.fillStyle = isMe ? COLORS.meBubble : COLORS.herBubble;
      roundRect(ctx, x, y + 4, bubbleW, bubbleH, 8);
      ctx.fill();

      ctx.fillStyle = COLORS.text;
      ctx.font = font(MSG_FONT);
      ctx.textAlign = "left";
      item.rows.forEach((row, i) => {
        ctx.fillText(row, x + 13, y + 4 + 20 + i * MSG_LINE_HEIGHT);
      });

      // 说话人小标签，避免「谁的绿气泡」分不清
      ctx.fillStyle = COLORS.muted;
      ctx.font = font(11);
      ctx.textAlign = isMe ? "right" : "left";
      ctx.fillText(isMe ? "你" : input.herName || "她", isMe ? WIDTH - PAD : PAD, y + 2);
      ctx.textAlign = "left";
      y += item.height;
      continue;
    }

    // 解读卡
    const meta = dangerMeta(item.analysis.danger.level);
    const cardX = PAD;
    const cardW = BUBBLE_MAX + 44;
    ctx.fillStyle = COLORS.card;
    roundRect(ctx, cardX, y + 2, cardW, item.height - 10, 10);
    ctx.fill();

    // 左侧一道按危险等级上色的竖条：扫一眼就知道哪张卡最要紧
    ctx.fillStyle = meta.color;
    roundRect(ctx, cardX, y + 2, 4, item.height - 10, 2);
    ctx.fill();

    ctx.fillStyle = COLORS.muted;
    ctx.font = font(11, "600");
    ctx.fillText("话外音 · AI 解读", cardX + 16, y + 24);

    ctx.fillStyle = meta.color;
    ctx.textAlign = "right";
    ctx.font = font(11, "600");
    ctx.fillText(meta.short, cardX + cardW - 16, y + 24);
    ctx.textAlign = "left";

    ctx.font = font(14);
    item.rows.forEach((row, i) => {
      const isFlag = row.startsWith("⚑");
      ctx.fillStyle = isFlag ? meta.color : COLORS.text;
      ctx.font = font(14, isFlag ? "600" : "400");
      ctx.fillText(row, cardX + 16, y + 48 + i * 22);
      ctx.font = font(14);
    });

    y += item.height;
  }

  // 页脚
  const footY = height - footHeight;
  ctx.fillStyle = COLORS.foot;
  ctx.fillRect(0, footY, WIDTH, footHeight);
  ctx.strokeStyle = COLORS.line;
  ctx.beginPath();
  ctx.moveTo(0, footY + 0.5);
  ctx.lineTo(WIDTH, footY + 0.5);
  ctx.stroke();

  ctx.fillStyle = COLORS.muted;
  ctx.font = font(12);
  ctx.textAlign = "center";
  ctx.fillText("结论由 Jev 模型算出，不是话术 · 话外音", WIDTH / 2, footY + 32);
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

function measure(ctx: CanvasRenderingContext2D, text: string, size: number): number {
  ctx.font = font(size);
  return ctx.measureText(text).width;
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
