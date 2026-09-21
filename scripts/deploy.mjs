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
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, ".env.local");
const WRANGLER_FILE = path.join(ROOT, "wrangler.jsonc");
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
  if (!existsSync(ENV_FILE)) {
    console.log("  没有 .env.local，跳过（密钥将由控制台提供）。");
    return {};
  }
  const env = {};
  for (const rawLine of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
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
function ensureDatabase(config) {
  log("3/5", `确认 D1 数据库 ${DB_NAME} 存在…`);

  // 已经填好真实 id 就跳过，避免每次部署都查询一遍
  const configured = /"database_id"\s*:\s*"([^"]+)"/.exec(config)?.[1];
  if (configured && isRealDatabaseId(configured)) {
    console.log(`  已配置：${configured}`);
    return config;
  }

  const listed = run(npx, ["wrangler", "d1", "list", "--json"]);
  if (!listed.failed) {
    try {
      // wrangler 有时会在 JSON 前后带上提示行，只取数组部分
      const json = JSON.parse(listed.stdout.slice(listed.stdout.indexOf("[")));
      const hit = Array.isArray(json) ? json.find((db) => db.name === DB_NAME) : null;
      if (hit?.uuid) {
        console.log(`  已存在，复用：${hit.uuid}`);
        return patchConfig(config, hit.uuid);
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
      "去 Cloudflare 控制台 D1 页面复制 ID，手动填进 wrangler.jsonc 的 database_id 再重跑。",
    );
  }
  console.log(`  创建完成：${uuid}`);
  return patchConfig(config, uuid);
}

function patchConfig(config, uuid) {
  const updated = config.replace(
    /"database_id"\s*:\s*"[^"]*"/,
    `"database_id": "${uuid}"`,
  );
  writeFileSync(WRANGLER_FILE, updated, "utf8");
  console.log("  已写回 wrangler.jsonc");
  return updated;
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
    console.log("  .env.local 里没有可用的 Key，跳过上传。");
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
  if (existsSync(OPEN_NEXT_DIR)) {
    console.log("  清理上一次的 .open-next…");
    try {
      rmSync(OPEN_NEXT_DIR, { recursive: true, force: true });
    } catch (error) {
      fail("清理 .open-next 失败。", `手动删掉 ${OPEN_NEXT_DIR} 再重跑。${error.message}`);
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

  const url = /https:\/\/[^\s]+\.workers\.dev/.exec(deploy.stdout)?.[0];
  if (!url) {
    console.log("\n没从输出里解析到线上地址，去 Cloudflare 控制台的 Workers 列表里找。");
    return;
  }
  console.log(`\n\u001b[32m✓ 上线了：${url}\u001b[0m`);

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
log("1/5", "读取 .env.local…");
const env = readEnvFile();
if (!existsSync(WRANGLER_FILE)) fail("找不到 wrangler.jsonc。");
let config = readFileSync(WRANGLER_FILE, "utf8");

ensureLoggedIn();
config = ensureDatabase(config);
ensureSecret(env[SECRET_NAME]);
await buildAndDeploy();

// config 在 ensureDatabase 里可能被改写（写回了 database_id），这里引用一次让它不被优化掉
void config;
