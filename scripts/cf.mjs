#!/usr/bin/env node
/**
 * Cloudflare 构建/部署的统一入口。
 *
 *   node scripts/cf.mjs build      # 只构建
 *   node scripts/cf.mjs preview    # 本地预览构建产物
 *   node scripts/cf.mjs deploy     # 部署已有构建产物（不含 build）
 *
 * 这一层解决两件事：
 *
 * 1. **Windows 下 fs.cpSync 的静默失败。**
 *    目标路径含非 ASCII 字符时，Node 的 fs.cpSync 递归复制会一个文件都不复制、也不报错，
 *    导致 OpenNext 在 `Bundling middleware function...` 处 ENOENT 崩掉。
 *    这里用 `node --require scripts/fix-cpsync.cjs <CLI>` 预加载补丁修掉它。
 *
 *    注意：**不要用 NODE_OPTIONS 传 --require** —— Node 会把路径里的反斜杠当转义符吃掉，
 *    `D:\a\b.cjs` 会变成 `D:abc.cjs` 并报 Cannot find module。用 argv 传零转义问题。
 *
 * 2. **本地配置与开源配置分离。**
 *    `wrangler.jsonc` 是提交进仓库的那份，D1 的 database_id 是占位值；
 *    真实的 id 属于账号、不能公开，所以放在 `wrangler.local.jsonc`（已 gitignore）。
 *    这个文件存在时就带上 `--config` 用它 —— 注意只对 deploy / preview 这两个 wrangler 命令生效，
 *    build 不需要（构建产物与 database_id 无关）。
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

/**
 * 防递归护栏。
 *
 * `opennextjs-cloudflare build` 内部会执行 `npm run build` 来构建 Next 应用本身。
 * 如果 package.json 里的 `build` 又指回 scripts/cf.mjs build，就会无限递归 ——
 * 而表现是**一行日志都不打、只是卡住**，非常难查（我为此浪费了两次半小时）。
 * 所以这里留一个环境变量标记：发现是子进程再调回来，直接报错说清原因。
 */
if (process.env.HW_CF_CHILD === "1") {
  console.error(
    [
      "✗ 检测到递归调用：scripts/cf.mjs 又通过 `npm run build` 调回了自己。",
      "  package.json 里的 `build` 必须是 `next build`（构建 Next 应用本身），",
      "  不能是 `node scripts/cf.mjs build`（那是 OpenNext 的打包，由 deploy 负责）。",
    ].join("\n"),
  );
  process.exit(1);
}

const preload = path.join(process.cwd(), "scripts", "fix-cpsync.cjs");
const localConfig = path.join(process.cwd(), "wrangler.local.jsonc");
const isWindows = process.platform === "win32";

/**
 * 定位 OpenNext 的 CLI 入口。
 *
 * 不能用 require.resolve("@opennextjs/cloudflare/cli/index") —— 那个包的 exports map
 * 会把 `./cli/index` 映射成 `./dist/cli/index.js`，而 require.resolve 会再补一次 .js，
 * 结果是 MODULE_NOT_FOUND。直接从 package.json 的 bin 字段读，最稳。
 */
function resolveCli() {
  try {
    const pkgDir = path.join(process.cwd(), "node_modules", "@opennextjs", "cloudflare");
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    const binEntry = pkg.bin?.["opennextjs-cloudflare"];
    if (!binEntry) return null;
    const cliPath = path.join(pkgDir, binEntry);
    return existsSync(cliPath) ? cliPath : null;
  } catch {
    return null;
  }
}

const cli = resolveCli();
if (!cli) {
  console.warn("⚠ 没找到 @opennextjs/cloudflare 的 CLI 入口，改用 npx（预加载补丁可能不生效）。");
}

// 只有会读 wrangler 配置的命令才需要指定本地配置
const needsWranglerConfig = (target) => target === "deploy" || target === "preview";
const hasLocalConfig = existsSync(localConfig);
if (hasLocalConfig) {
  console.log(`使用本地配置：wrangler.local.jsonc（含真实的 database_id，不会提交）`);
}

for (const target of targets) {
  const extra =
    needsWranglerConfig(target) && hasLocalConfig
      ? ["--config", path.relative(process.cwd(), localConfig)]
      : [];

  const result = cli
    ? spawnSync(
        process.execPath,
        ["--require", preload, cli, target, ...extra],
        {
          cwd: process.cwd(),
          stdio: "inherit",
          env: { ...process.env, HW_BUILD_TRACE: "1", HW_CF_CHILD: "1" },
        },
      )
    : spawnSync(
        isWindows ? "npx.cmd" : "npx",
        ["opennextjs-cloudflare", target, ...extra],
        {
          cwd: process.cwd(),
          shell: isWindows,
          stdio: "inherit",
          env: {
            ...process.env,
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${preload}`.trim(),
            HW_CF_CHILD: "1",
          },
        },
      );

  if (result.status !== 0) {
    console.error(`\n✗ opennextjs-cloudflare ${target} 失败（退出码 ${result.status ?? "?"}）`);
    process.exit(result.status ?? 1);
  }
}
