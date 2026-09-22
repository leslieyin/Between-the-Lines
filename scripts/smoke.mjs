#!/usr/bin/env node
/**
 * 接口冒烟测试。
 *
 *   node scripts/smoke.mjs [baseUrl]
 *
 * 默认打 http://127.0.0.1:3000，需要本地已经 `npm run dev` 起来。
 * 走一遍真实链路：探针 → 分析 → 历史列表 → 取单条 → 生成分享 → 读分享页 → 关系档案 → 清空。
 *
 * 为什么用 Node 的 fetch 而不是 curl：Node 的 fetch 默认不读 HTTP_PROXY，
 * 能直连本地端口，不受公司/沙箱代理干扰。
 */

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  \u001b[31m✗\u001b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** 极简 cookie jar：这个应用只需要带一个设备标识 cookie 来回。 */
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorbCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(jar.size > 0 ? { Cookie: cookieHeader() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  absorbCookies(response);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

const SAMPLE = {
  raw: [
    "她：你今天是不是又忘了我跟你说过什么？",
    "我：记得，你先别提示我，让我自己说。",
    "她：那你说。",
    "我：等一下，我想说完整一点。",
    "她：你最好是。",
    "我：我想起来了。你昨天跟我说周末想出去吃饭，而且你不想每次都是你来安排。",
    "她：所以呢？",
    "我：所以这次我来安排，餐厅和时间我定好再告诉你，你只负责去。",
    "她：这还差不多。",
  ].join("\n"),
  herName: "宝儿",
  relation: "情侣，在一起 2 年",
  extra: "昨天答应她的事我忘了",
};

async function main() {
  console.log(`\n冒烟测试目标：${BASE}\n`);

  console.log("[1] 探针");
  const health = await call("GET", "/api/health");
  check("GET /api/health 返回 200", health.status === 200, `status=${health.status}`);
  check("health.status === ok", health.json?.data?.status === "ok");

  const ready = await call("GET", "/api/ready");
  check(
    "GET /api/ready 就绪（配置 + 数据库都通）",
    ready.json?.data?.ready === true,
    JSON.stringify(ready.json?.data?.config ?? {}),
  );

  console.log("\n[2] 分析");
  const analyzed = await call("POST", "/api/analyze", SAMPLE);
  check("POST /api/analyze 返回 200", analyzed.status === 200, `status=${analyzed.status}`);
  if (analyzed.status !== 200) {
    console.log(`    响应：${analyzed.text.slice(0, 400)}`);
    return report();
  }

  const record = analyzed.json.data;
  check("返回含 id 与 createdAt", typeof record.id === "string" && record.createdAt > 0);
  check("识别出 5 句她说的话", record.herLines === 5, `herLines=${record.herLines}`);
  check("整段有 verdict/trend/priority", Boolean(
    record.snapshot.conversation.verdict && record.snapshot.conversation.trend && record.snapshot.conversation.priority,
  ));
  check(
    "逐句都带 intent/need/danger/move",
    record.snapshot.analyzed.every((l) => l.intent?.key && l.need?.key && l.danger?.key && l.move?.key),
  );
  check(
    "危险等级落在 0..3",
    record.snapshot.analyzed.every((l) => Number.isInteger(l.danger.level) && l.danger.level >= 0 && l.danger.level <= 3),
  );
  check("peakDanger 与逐句一致", record.peakDanger === Math.max(...record.snapshot.analyzed.map((l) => l.danger.level)));
  check("设备 cookie 已下发", jar.has("hw_did"));

  console.log("\n[3] 历史");
  const list = await call("GET", "/api/analyses");
  check("GET /api/analyses 有刚才那条", list.json?.data?.items?.some((i) => i.id === record.id));
  const one = await call("GET", `/api/analyses/${record.id}`);
  check("GET /api/analyses/:id 能取回", one.json?.data?.id === record.id);

  console.log("\n[4] 分享");
  const shared = await call("POST", `/api/analyses/${record.id}/share`);
  const slug = shared.json?.data?.slug;
  check("POST .../share 返回 slug", typeof slug === "string" && slug.length === 12, `slug=${slug}`);
  const again = await call("POST", `/api/analyses/${record.id}/share`);
  check("重复生成返回同一个 slug（幂等）", again.json?.data?.slug === slug);

  const sharePage = await fetch(`${BASE}/s/${slug}`);
  const html = await sharePage.text();
  check("GET /s/:slug 分享页渲染成功", sharePage.status === 200, `status=${sharePage.status}`);
  check("分享页里能看到解读内容", html.includes("懂你") || html.includes("她真正想说的"));

  const badSlug = await fetch(`${BASE}/s/zzzzzzzzzzzz`);
  check("无效 slug 返回 404", badSlug.status === 404, `status=${badSlug.status}`);

  console.log("\n[5] 关系档案");
  const profile = await call("GET", "/api/profile");
  check("GET /api/profile 200", profile.status === 200);
  const saved = await call("PUT", "/api/profile", { herName: "宝儿", relation: "情侣", extra: null });
  check("PUT /api/profile 保存成功", saved.json?.data?.herName === "宝儿");

  console.log("\n[6] 边界与错误");
  const short = await call("POST", "/api/analyze", { raw: "嗯" });
  check("太短的输入被拒（422）", short.status === 422, `status=${short.status}`);
  const noSpeaker = await call("POST", "/api/analyze", { raw: "今天天气不错\n明天也还行" });
  check("认不出她的发言时给出可读提示", noSpeaker.status === 422, noSpeaker.json?.error?.message?.slice(0, 40));
  const missing = await call("GET", "/api/analyses/00000000-0000-4000-8000-000000000000");
  check("不存在的记录返回 404", missing.status === 404, `status=${missing.status}`);
  check(
    "错误响应结构统一且带 requestId",
    missing.json?.ok === false && typeof missing.json?.error?.requestId === "string",
  );
  const badBody = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not json",
  });
  check("非法 JSON 不返回 500", badBody.status >= 400 && badBody.status < 500, `status=${badBody.status}`);

  console.log("\n[7] 清空");
  const cleared = await call("DELETE", "/api/analyses");
  check("DELETE /api/analyses 成功", cleared.status === 200, JSON.stringify(cleared.json?.data));
  const afterClear = await call("GET", "/api/analyses");
  check("清空后列表为空", afterClear.json?.data?.items?.length === 0);

  console.log("\n[8] 说话人指认（两个真实昵称）");
  // 从微信「合并转发」复制出来的真实形态：说话人是两个昵称，没有任何「她/我」的字样。
  // 这种输入必须走「哪个是你」的指认，而不是直接报「没认出哪句是她说的」。
  const NAMED_CHAT = [
    "gaoo 2026-09-21 12:00",
    "你今天是不是又忘了我跟你说过什么",
    "Leslie 2026-09-21 12:01",
    "记得，你先别提示我，让我自己说",
    "gaoo 2026-09-21 12:02",
    "那你说",
    "Leslie 2026-09-21 12:03",
    "等一下，我想说完整一点",
    "gaoo 2026-09-21 12:04",
    "你最好是",
    "Leslie 2026-09-21 12:05",
    "我想起来了。你昨天跟我说周末想出去吃饭，而且你不想每次都是你来安排",
    "gaoo 2026-09-21 12:06",
    "所以呢",
    "Leslie 2026-09-21 12:07",
    "所以这次我来安排，餐厅和时间我定好再告诉你，你只负责去",
    "gaoo 2026-09-21 12:08",
    "这还差不多",
  ].join("\n");

  const noPick = await call("POST", "/api/analyze", { raw: NAMED_CHAT });
  check("没指认「哪个是你」时返回 422", noPick.status === 422, `status=${noPick.status}`);
  check(
    "错误文案里带上了两个候选昵称",
    typeof noPick.json?.error?.message === "string" &&
      noPick.json.error.message.includes("gaoo") &&
      noPick.json.error.message.includes("Leslie"),
    noPick.json?.error?.message?.slice(0, 60),
  );

  const picked = await call("POST", "/api/analyze", { raw: NAMED_CHAT, youAre: "Leslie" });
  check("指认 Leslie 之后分析成功", picked.status === 200, `status=${picked.status}`);
  check(
    "算的是另一个人（gaoo）的 5 句",
    picked.json?.data?.herLines === 5,
    `herLines=${picked.json?.data?.herLines}`,
  );
  check(
    "她说的那句是 gaoo 的内容，不是你自己的",
    picked.json?.data?.snapshot?.analyzed?.every((l) => !l.text.includes("我想起来了")),
  );
  check(
    "逐句仍然带齐 intent/need/danger/move",
    picked.json?.data?.snapshot?.analyzed?.every(
      (l) => l.intent?.key && l.need?.key && l.danger?.key && l.move?.key,
    ),
  );

  // 回归：指认结果存在本机、跨对话复用。换了一段聊天后，上次那个名字跟新内容无关。
  // 如果照样当「我」，解析器会因「两个说话人 + 有一个是我」把**另外两个人一起判成「她」**，
  // 把对方的话全算进来，而界面上看不出异常。必须当成没指认。
  const stalePick = await call("POST", "/api/analyze", { raw: NAMED_CHAT, youAre: "zhangsna" });
  check(
    "指认的名字不属于这段对话时，当作没指认（422）而不是两个人一起算",
    stalePick.status === 422,
    `status=${stalePick.status}`,
  );
  check(
    "错误文案仍然带候选昵称，引导重新指认",
    typeof stalePick.json?.error?.message === "string" &&
      stalePick.json.error.message.includes("gaoo"),
    stalePick.json?.error?.message?.slice(0, 50),
  );

  report();
}

function report() {
  console.log(`\n${failed === 0 ? "\u001b[32m全部通过\u001b[0m" : "\u001b[31m有失败项\u001b[0m"}：${passed} 通过 / ${failed} 失败\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n冒烟测试异常终止：", error instanceof Error ? error.message : error);
  process.exit(1);
});
