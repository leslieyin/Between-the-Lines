#!/usr/bin/env node
/**
 * 一键部署到 Cloudflare。
 *
 *   npm run deploy
 *
 * 它会按顺序做完这几件事，任何一步失败都会停下来并说清原因：
 *   1. 读 .env.local，拿到 TYPESAFE_API_KEY
 *   2. 检查 wrangler 是否已登录
 *   3. 确认 D1 数据库存在（不存在就创建），并把 database_id 写回 wrangler.jsonc
 *   4. 把 API Key 作为 Worker secret 上传（不落进代码库，也不出现在 wrangler.jsonc 里）
 *   5. 构建并部署，最后打印线上地址
 *
 * 之所以写成脚本而不是让用户手敲五条命令：手敲的那五条里，第 3 步（把 id 粘回配置）
 * 是最容易出错的一步，而它完全可以自动化。
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
/**
 * 本地变量文件：用 wrangler 约定的 `.dev.vars`，**不要**用 `.env.local`。
 * 因为 next build 会把 `.env.local` 的值快照进服务端 bundle，一路渗进线上。
 */
const ENV_FILE = path.join(ROOT, ".dev.vars");
/** 老路径，仅作兜底兼容 */
const LEGACY_ENV_FILE = path.join(ROOT, ".env.local");
const WRANGLER_FILE = path.join(ROOT, "wrangler.jsonc");
/** 本地专用的 wrangler 配置（已 gitignore），只比 wrangler.jsonc 多一个真实的 database_id */
const LOCAL_WRANGLER_FILE = path.join(ROOT, "wrangler.local.jsonc");
const OPEN_NEXT_DIR = path.join(ROOT, ".open-next");
const DB_NAME = "huawaiyin-db";
const SECRET_NAME = "TYPESAFE_API_KEY";

const isWindows = process.platform === "win32";
const shell = isWindows;

function log(step, message) {
  console.log(`\n\u001b[36m[${step}]\u001b[0m ${message}`);
}

function fail(message, hint) {
  console.error(`\n\u001b[31m✗ ${message}\u001b[0m`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

/** 跑一条命令并返回 stdout；失败时把 stderr 一起带出来，方便定位。 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    shell,
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : "pipe",
    input: options.input,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (options.capture === false) {
    // 实时流式输出的命令（比如构建）：不在这里直接退出，把成败交回调用方，
    // 让调用方能补一句更有用的上下文，而不是只丢一个「命令失败」。
    return { failed: result.status !== 0, stdout: "", stderr: "" };
  }
  if (result.status !== 0) {
    return { failed: true, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
  return { failed: false, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const npx = isWindows ? "npx.cmd" : "npx";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_IDS = new Set([
  "PENDING_FIRST_DEPLOY",
  "00000000-0000-0000-0000-000000000000",
]);

/**
 * wrangler.jsonc 里的 database_id 是不是真的可用。
 *
 * 开源仓库里必须放占位值 —— 真实的 id 是账号专属的，别人克隆过去会指向一个不存在的库。
 * Cloudflare 的一键部署流程会自己替换占位值；本地这条 `deploy:local` 流程则是
 * 按库名去 `wrangler d1 list` 里找，找到就回填真实 id。
 */
function isRealDatabaseId(value) {
  return UUID_PATTERN.test(value) && !PLACEHOLDER_IDS.has(value.toUpperCase());
}

// ── 1. 读 .env.local（可选） ────────────────────────────────────────────────
/**
 * 这个文件存在只为一件事：把 Key 自动上传成 Worker secret。
 * 如果你选择在 Cloudflare 控制台配密钥，这个文件完全可以不存在 —— 所以缺了不报错，
 * 只提示一句，后面照样继续跑。
 */
function readEnvFile() {
  const target = existsSync(ENV_FILE)
    ? ENV_FILE
    : existsSync(LEGACY_ENV_FILE)
      ? LEGACY_ENV_FILE
      : null;

  if (target === null) {
    console.log("  没有 .dev.vars，跳过（密钥将由 Cloudflare 控制台提供）。");
    return {};
  }

  const env = {};
  for (const rawLine of readFileSync(target, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// ── 2. 登录检查 ─────────────────────────────────────────────────────────────
function ensureLoggedIn() {
  log("2/5", "检查 Cloudflare 登录状态…");
  const result = run(npx, ["wrangler", "whoami"]);
  if (result.failed || /not authenticated|You are not authenticated/i.test(result.stdout + result.stderr)) {
    fail(
      "还没登录 Cloudflare。",
      "先在终端跑一次 `npx wrangler login`，浏览器里点一下授权，然后重新执行 npm run deploy。",
    );
  }
  const email = /associated with the email\s+(\S+)/.exec(result.stdout)?.[1];
  console.log(`  已登录：${email ?? "（账号信息见上方输出）"}`);
}

// ── 3. D1 数据库 ────────────────────────────────────────────────────────────
/**
 * 确保 D1 数据库存在，并把**真实的** database_id 写进 `wrangler.local.jsonc`（已 gitignore）。
 * 同时把 `.dev.vars` 里的 CUSTOM_DOMAIN（如果有）写成一条 routes。
 *
 * 为什么这两个值都不能留在 `wrangler.jsonc`：那份要提交进开源仓库，而 database_id 和
 * 域名都是账号专属的 —— 别人克隆过去点部署按钮，会指向一个不存在的库、或一个不属于他的
 * 域名，部署当场失败。一个文件没法同时满足「本地能部署」和「开源仓库要占位值」，
 * 所以拆成两份，`scripts/cf.mjs` 检测到本地那份就用 `--config` 指过去。
 */
function ensureDatabase(customDomain) {
  log("3/5", `确认 D1 数据库 ${DB_NAME} 存在…`);

  const committed = readFileSync(WRANGLER_FILE, "utf8");

  // 本地配置里已经有真实 id 就复用，省掉一次网络查询。
  // 但自定义域变了要重新生成 —— 否则改了域名不生效，还很难看出为什么。
  if (existsSync(LOCAL_WRANGLER_FILE)) {
    const local = readFileSync(LOCAL_WRANGLER_FILE, "utf8");
    const id = /"database_id"\s*:\s*"([^"]+)"/.exec(local)?.[1];
    const domainMatches = !customDomain || local.includes(customDomain);
    if (id && isRealDatabaseId(id) && domainMatches) {
      // 复用现有的 D1 id，但仍用 wrangler.jsonc 重新生成一份本地配置 ——
      // 否则 wrangler.jsonc 里 vars 的改动（比如 ANALYZE_MAX_LINES）会被旧配置静默吞掉，
      // 表现出来就是「明明改了 100 行，部署完线上还是 40 行」，且日志一行不错、极难发现。
      console.log(`  复用本地配置里的数据库 id：${id}（并同步 wrangler.jsonc 的 vars）`);
      writeLocalWrangler(committed, id, customDomain);
      return;
    }
  }

  const listed = run(npx, ["wrangler", "d1", "list", "--json"]);
  if (!listed.failed) {
    try {
      // wrangler 有时会在 JSON 前后带上提示行，只取数组部分
      const json = JSON.parse(listed.stdout.slice(listed.stdout.indexOf("[")));
      const hit = Array.isArray(json) ? json.find((db) => db.name === DB_NAME) : null;
      if (hit?.uuid) {
        console.log(`  账号里已存在，复用：${hit.uuid}`);
        writeLocalWrangler(committed, hit.uuid, customDomain);
        return;
      }
    } catch {
      console.log("  列表解析失败，改为直接尝试创建。");
    }
  }

  console.log("  不存在，创建中…");
  const created = run(npx, ["wrangler", "d1", "create", DB_NAME]);
  if (created.failed) {
    fail("创建 D1 数据库失败。", created.stderr.trim() || created.stdout.trim());
  }
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
    created.stdout,
  )?.[1];
  if (!uuid) {
    fail(
      "创建成功但没解析出 database_id。",
      "去 Cloudflare 控制台 D1 页面复制 ID，手动填进 wrangler.local.jsonc 的 database_id 再重跑。",
    );
  }
  console.log(`  创建完成：${uuid}`);
  writeLocalWrangler(committed, uuid, customDomain);
}

/** 把真实 id（以及可选的自定义域）注入一份本地配置。提交进仓库的那份保持原样。 */
function writeLocalWrangler(committedConfig, uuid, customDomain) {
  const header = [
    "// 本文件由 npm run deploy:local 自动生成，已 gitignore，**不要提交**。",
    "// 内容 = wrangler.jsonc + 真实的 D1 database_id + .dev.vars 里的 CUSTOM_DOMAIN。",
    "// 开源仓库里那份 wrangler.jsonc 必须保持占位值，否则别人点部署按钮会指向不存在的库、",
    "// 或挂上一个不属于他的域名。",
    "",
  ].join("\n");

  let body = committedConfig.replace(/"database_id"\s*:\s*"[^"]*"/, `"database_id": "${uuid}"`);

  if (customDomain) {
    const block = [
      `  "routes": [`,
      `    {`,
      `      "pattern": "${customDomain}",`,
      `      "custom_domain": true`,
      `    }`,
      `  ],`,
      ``,
    ].join("\n");
    // 仓库里那份把 routes 注释掉了（避免别人部署时挂上别人的域名）。
    // 这里要么替换已有的 pattern，要么在开头插一段新的 —— 两条路都不会留下重复。
    //
    // 两个正则都锚定行首（`^\s*"`）是必须的：被注释掉那段同样含有 `"routes":` 和
    // `"pattern":`，不锚定的话会误命中注释，结果 routes 根本没插进去 —— 表现出来就是
    // 「明明配了 CUSTOM_DOMAIN，部署完域名却没绑上」，且日志一行不错，极难发现。
    body = /^\s*"routes"\s*:/m.test(body)
      ? body.replace(/^(\s*)"pattern"\s*:\s*"[^"]*"/m, `$1"pattern": "${customDomain}"`)
      : body.replace(/^(\{\s*\r?\n)/, `$1${block}`);
    console.log(`  已带上自定义域：${customDomain}`);
  }

  writeFileSync(LOCAL_WRANGLER_FILE, header + body, "utf8");
  console.log("  已写入 wrangler.local.jsonc（本地配置，不会提交）");
}

// ── 4. 上传密钥（可选） ─────────────────────────────────────────────────────
/**
 * 密钥有两种正当来源，脚本都要接受：
 *   a) 本机 .env.local 里有 → 上传为 Worker secret（自动化，推荐）
 *   b) 你已经在 Cloudflare 控制台的 Variables and Secrets 里配好了 → 这里留空，跳过
 * 所以本地没填 Key **不是**错误，只是少做一步。跳过之后仍会在部署末尾探测线上是否真的配上了。
 */
function ensureSecret(apiKey) {
  log("4/5", `处理 ${SECRET_NAME}…`);

  const looksLikePlaceholder =
    !apiKey || apiKey.startsWith("ts_live_xxx") || apiKey.startsWith("ts_live_...");

  if (looksLikePlaceholder) {
    console.log("  .dev.vars 里没有可用的 Key，跳过上传。");
    console.log(
      "  请确认已在 Cloudflare 控制台配置：Worker → Settings → Variables and Secrets →\n" +
        `  Runtime variables and secrets 里加上 ${SECRET_NAME}（类型选 Secret）。`,
    );
    return false;
  }

  const result = run(npx, ["wrangler", "secret", "put", SECRET_NAME], { input: `${apiKey}\n` });
  if (result.failed) {
    fail("上传密钥失败。", result.stderr.trim() || result.stdout.trim());
  }
  console.log("  已上传（注意：这会覆盖控制台里同名的那份值）");
  return true;
}

// ── 5. 构建并部署 ───────────────────────────────────────────────────────────
async function buildAndDeploy() {
  log("5/5", "构建并部署…");

  // 构建前先清掉 .open-next：OpenNext 内部会 rmSync 它，在 Windows 上这一步会卡死
  // （目录里上百个文件，撞上本机的删除保护，非交互进程里就变成永久等待）。
  // 注意：本机 WorkBuddy 的删除保护层会拦截 rmSync（批量删除需授权），所以这里用
  // rename 把目录挪到一旁而不是删掉 —— 单次 rename 不触发删除保护，构建会生成全新的 .open-next。
  if (existsSync(OPEN_NEXT_DIR)) {
    const badDir = path.join(ROOT, `.open-next-bad-${Date.now()}`);
    console.log(`  把上一次的 .open-next 挪到 ${path.basename(badDir)}（避免触发删除保护）…`);
    try {
      renameSync(OPEN_NEXT_DIR, badDir);
    } catch (error) {
      fail("清理 .open-next 失败。", `手动把 ${OPEN_NEXT_DIR} 改名或删掉再重跑。${error.message}`);
    }
  }

  // 走 scripts/cf.mjs 而不是直接调 opennextjs-cloudflare：那一层会用 node --require 预加载
  // fix-cpsync.cjs，修掉 Node 在 Windows + 中文路径下 fs.cpSync 静默失败的问题。
  //
  // 用 capture:false 让构建输出实时流到终端 —— 构建要三四分钟，全都攒到最后才打印的话，
  // 用户看到的就是「卡住了」。部署那一步需要抓取输出里的地址，所以保留捕获。
  const result = run(process.execPath, ["scripts/cf.mjs", "build"], { capture: false });
  if (result.failed) fail("构建失败。上面是构建日志，拉到最上面找第一个 ERROR。");

  console.log("  构建完成，正在部署…");
  const deploy = run(process.execPath, ["scripts/cf.mjs", "deploy"]);
  if (deploy.failed) {
    console.error(deploy.stdout);
    fail("部署失败。", deploy.stderr.trim());
  }
  console.log(deploy.stdout);

  // 部署输出里的地址有两种形态：workers.dev 带 https:// 前缀；
  // 自定义域是裸域名后面跟一个 (custom domain) 标记。
  const workersDev = /https:\/\/[^\s]+\.workers\.dev/.exec(deploy.stdout)?.[0];
  const customDomain = /^\s+([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s*\(custom domain\)/im.exec(
    deploy.stdout,
  )?.[1];
  const url = workersDev ?? (customDomain ? `https://${customDomain}` : null);

  if (!url) {
    console.log("\n没从输出里解析到线上地址，去 Cloudflare 控制台的 Workers 列表里找。");
    return;
  }
  console.log(`\n\u001b[32m✓ 上线了：${url}\u001b[0m`);
  if (customDomain) {
    console.log("  （已绑自定义域。*.workers.dev 在国内 DNS 被污染，基本打不开）");
  }

  await verifyRuntime(url);
}

/**
 * 部署完直接问一次线上的 /api/ready，把「配置齐没齐、数据库通没通」当场告诉你。
 * 这一步是为了省掉「部署成功 → 打开网站 → 报错 → 再回来查日志」那个来回：
 * 密钥配在控制台的人，最需要知道的就是它到底有没有被读到。
 */
async function verifyRuntime(url) {
  console.log("\n检查线上运行时配置…");
  try {
    const response = await fetch(`${url}/api/ready`, { signal: AbortSignal.timeout(20_000) });
    const payload = await response.json();
    const data = payload?.data ?? {};
    const config = data.config ?? {};
    const database = data.database ?? {};

    console.log(`  数据库绑定：${database.ok ? "✓ 已接上" : `✗ ${database.error ?? "未接上"}`}`);
    if (config.configured) {
      console.log(
        `  模型配置：  ${config.demoMode ? "△ 处于演示模式（DEMO_MODE=true）" : "✓ 已就绪"}${
          config.model ? ` · ${config.model}` : ""
        }`,
      );
    } else {
      console.log("  模型配置：  ✗ 没读到 API Key");
      console.log(
        `\n  去 Cloudflare 控制台补上：Worker → Settings → Variables and Secrets →\n` +
          `  Runtime variables and secrets → 添加 ${SECRET_NAME}（类型 Secret）。\n` +
          "  改完即生效，不用重新部署。",
      );
      return;
    }

    if (config.demoMode) {
      console.log(
        "\n  \u001b[33m注意：现在线上跑的是演示数据，不是 Jev 算的。\u001b[0m\n" +
          "  检查控制台里有没有 DEMO_MODE=true —— 有就删掉或改成 false。",
      );
    }
  } catch (error) {
    console.log(`  探测失败（不影响部署本身）：${error.message}`);
    console.log(`  手动确认一下：${url}/api/ready`);
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
log("1/5", "读取本地变量（.dev.vars）…");
const env = readEnvFile();
if (!existsSync(WRANGLER_FILE)) fail("找不到 wrangler.jsonc。");

ensureLoggedIn();
ensureDatabase(env.CUSTOM_DOMAIN?.trim() || "");
ensureSecret(env[SECRET_NAME]);
await buildAndDeploy();
