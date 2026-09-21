#!/usr/bin/env node
/**
 * Cloudflare 构建/部署的统一入口。
 *
 *   node scripts/cf.mjs build      # 只构建
 *   node scripts/cf.mjs preview    # 本地预览构建产物
 *   node scripts/cf.mjs deploy     # 构建并部署（不含 build）
 *
 * 为什么要有这层壳：它用 `node --require scripts/fix-cpsync.cjs <CLI>` 预加载修复脚本，
 * 修掉 Node 在 Windows 下「目标路径含非 ASCII 字符时 fs.cpSync 静默复制 0 个文件」的行为。
 * 不修的话 opennextjs-cloudflare build 会在 Bundling middleware 那步 ENOENT 崩掉，
 * 而项目路径里只要有中文就会触发 —— 本机路径是 D:\Leslie\github工具\dongta。
 *
 * 两个实现细节是踩出来的：
 *  1. 不用 NODE_OPTIONS 传 --require：它会把路径里的反斜杠当转义符吃掉，
 *     结果变成 D:Lesliegithub工具dongtascriptsfix-cpsync.cjs。改用 argv 传，零转义问题。
 *  2. 直接调 CLI 的入口文件，而不是 `npx opennextjs-cloudflare` —— 少一层 shell，
 *     报错也更直白。
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const STEPS = {
  build: ["build"],
  preview: ["preview"],
  deploy: ["deploy"],
};

const step = process.argv[2];
const targets = STEPS[step];

if (!targets) {
  console.error("用法：node scripts/cf.mjs <build|preview|deploy>");
  process.exit(1);
}

const preload = path.join(process.cwd(), "scripts", "fix-cpsync.cjs");
const require = createRequire(import.meta.url);

function resolveCli() {
  try {
    return require.resolve("@opennextjs/cloudflare/cli/index.js");
  } catch {
    return null;
  }
}

const cli = resolveCli();

for (const target of targets) {
  const result = cli
    ? spawnSync(process.execPath, ["--require", preload, cli, target], {
        cwd: process.cwd(),
        stdio: "inherit",
        env: { ...process.env, HW_BUILD_TRACE: "1" },
      })
    : spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["opennextjs-cloudflare", target], {
        cwd: process.cwd(),
        shell: process.platform === "win32",
        stdio: "inherit",
        env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${preload}`.trim() },
      });

  if (result.status !== 0) {
    console.error(`\n✗ opennextjs-cloudflare ${target} 失败（退出码 ${result.status ?? "?"}）`);
    process.exit(result.status ?? 1);
  }
}
