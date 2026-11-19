import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { serve } from "@hono/node-server";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";
import { emptyData } from "../../src/lib/validate.ts";
import type { AppData, Timeline } from "../../src/lib/types.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cal-sync-"));
const config: Config = {
  port: 0,
  dataDir: TMP,
  registerCode: "test-code",
  secret: "unit-test-secret",
  tokenDays: 1,
};

let server: ReturnType<typeof serve>;
let base = "";
let token = "";
let tokenB = "";

before(async () => {
  server = serve({ fetch: createApp(config).fetch, port: 0 });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  base = `http://localhost:${port}`;
});

after(() => {
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

test("AI 入口沿用账号鉴权，未登录不能探测或调用模型", async () => {
  assert.equal((await fetch(base + "/api/ai/capabilities")).status, 401);
  assert.equal(
    (
      await fetch(base + "/api/ai/events/interpret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
});

/** 使用指定来源 IP 请求注册接口，供注册码和账号隔离测试使用。 */
function register(ip: string, username: string, password: string, code: string) {
  return fetch(`${base}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ username, password, code }),
  });
}

/** 使用指定来源 IP 请求登录接口，供鉴权和限流测试使用。 */
function login(ip: string, username: string, password: string) {
  return fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ username, password }),
  });
}

test("时间线 API 往返、旧端上传、分享分发与重启读取保留排程", async () => {
  // Independent account keeps this scenario separate from the existing sharing tests.
  const registration = await register(
    "timeline-test",
    "timelineuser",
    "timeline-password",
    "test-code",
  );
  assert.equal(registration.status, 200);
  const auth = ((await registration.json()) as { token: string }).token;
  /** 以测试账号上传日历快照，确认成功后读取服务端合并结果。 */
  const push = async (data: unknown) => {
    const res = await fetch(`${base}/api/data`, {
      method: "POST",
      headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
      body: JSON.stringify({ data }),
    });
    assert.equal(res.status, 200);
    return ((await res.json()) as { data: AppData }).data;
  };
  const now = Date.now();
  const t: Timeline = {
    id: "timeline-api",
    name: "跨天",
    date: "2026-10-07",
    startTime: "23:00",
    endTime: "23:00",
    items: [{ id: "i", planId: "timeline-plan", durationMinutes: 90 }],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const plan = {
    id: "timeline-plan",
    date: t.date,
    text: "阅读",
    done: false,
    doneAt: null,
    domain: "life" as const,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const data = { ...emptyData(), plans: [plan], timelines: [t] };
  assert.deepEqual((await push(data)).timelines, [t]);
  const friend = await register(
    "timeline-friend-test",
    "timelinefriend",
    "timeline-password",
    "test-code",
  );
  const friendToken = ((await friend.json()) as { token: string }).token;
  const friendData = {
    ...data,
    plans: [{ ...plan, id: "friend-plan" }],
    timelines: [{ ...t, id: "friend-line", items: [{ ...t.items[0], planId: "friend-plan" }] }],
  };
  await fetch(`${base}/api/data`, {
    method: "POST",
    headers: { authorization: `Bearer ${friendToken}`, "content-type": "application/json" },
    body: JSON.stringify({ data: friendData }),
  });
  await push({ ...data, plans: [{ ...plan, shareWith: ["timelinefriend"], updatedAt: now + 1 }] });
  const received = await fetch(`${base}/api/data`, {
    headers: { authorization: `Bearer ${friendToken}` },
  });
  const receivedData = ((await received.json()) as { data: AppData }).data;
  assert.ok(receivedData.plans.some((p) => p.sharedBy === "timelineuser"));
  assert.deepEqual(receivedData.timelines, friendData.timelines, "分享分发不能丢掉接收方时间线");
  const { timelines: _ignored, ...oldClient } = data;
  assert.deepEqual((await push(oldClient)).timelines, [t]);
  const { endTime: _deadline, ...forwardClientLine } = t;
  const legacyEdit = {
    ...forwardClientLine,
    updatedAt: now + 5,
    items: [{ ...t.items[0], durationMinutes: 150 }],
  };
  assert.deepEqual(
    (await push({ ...oldClient, timelines: [legacyEdit] })).timelines,
    [t],
    "旧正排客户端不能改变倒推时间线的目标",
  );
  assert.deepEqual(
    (await push({ ...data, timelines: [{ ...t, items: [{ ...t.items[0], durationMinutes: 0 }] }] }))
      .timelines,
    [t],
  );
  const restarted = createApp(config);
  const reload = await restarted.request("/api/data", {
    headers: { authorization: `Bearer ${auth}` },
  });
  assert.deepEqual(((await reload.json()) as { data: AppData }).data.timelines, [t]);
  const health = await restarted.request("/api/health");
  assert.ok(
    ((await health.json()) as { capabilities: string[] }).capabilities.includes("timelines-v1"),
  );
  const gone = { ...t, updatedAt: now + 1, deletedAt: now + 1 };
  assert.equal((await push({ ...data, timelines: [gone] })).timelines[0].deletedAt, now + 1);
  assert.equal((await push(oldClient)).timelines[0].deletedAt, now + 1);
});

test("健康检查可匿名访问", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { ok: boolean }).ok, true);
});

test("独立步骤与目标计划往返、旧端不能覆盖，重启后步骤仍保留", async () => {
  const registration = await register("goal-test", "goaluser", "goal-password", "test-code");
  const auth = ((await registration.json()) as { token: string }).token;
  /** 以测试账号上传日历快照，确认成功后读取服务端合并结果。 */
  const push = async (data: AppData) => {
    const res = await fetch(`${base}/api/data`, {
      method: "POST",
      headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
      body: JSON.stringify({ data }),
    });
    assert.equal(res.status, 200);
    return ((await res.json()) as { data: AppData }).data;
  };
  const now = Date.now();
  const step = {
    id: "private-step",
    text: "整理",
    date: "2026-10-13",
    domain: "life" as const,
    done: false,
    doneAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const line: Timeline = {
    id: "goal-line",
    name: "提交",
    date: step.date,
    startTime: "18:00",
    endTime: "18:00",
    stepsMode: true,
    goalPlanId: "timeline-goal:goal-line",
    domain: "life",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    items: [{ id: "i", planId: step.id, durationMinutes: 30, step }],
  };
  const data = {
    ...emptyData(),
    plans: [{ ...step, id: line.goalPlanId!, text: line.name }],
    timelines: [line],
  };
  assert.deepEqual((await push(data)).timelines, [line]);
  const oldLine = {
    ...line,
    stepsMode: undefined,
    goalPlanId: undefined,
    updatedAt: now + 10,
    items: line.items.map(({ step: _step, ...item }) => item),
  };
  assert.deepEqual((await push({ ...data, timelines: [oldLine] })).timelines, [line]);
  const restarted = createApp(config);
  const reload = await restarted.request("/api/data", {
    headers: { authorization: `Bearer ${auth}` },
  });
  const restored = ((await reload.json()) as { data: AppData }).data;
  assert.deepEqual(restored.timelines, [line]);
  assert.equal(restored.plans.filter((p) => p.deletedAt === null).length, 1);
  const removed = { ...line, updatedAt: now + 20, deletedAt: now + 20, items: [] };
  assert.equal((await push({ ...data, timelines: [removed] })).timelines[0].deletedAt, now + 20);
});

test("未登录访问数据接口返回 401", async () => {
  const res = await fetch(`${base}/api/data`);
  assert.equal(res.status, 401);
});

test("注册码错误 403，正确注册返回 token", async () => {
  const wrong = await register("10.0.0.1", "老咪", "test-password-123", "bad-code");
  assert.equal(wrong.status, 403);

  const short = await register("10.0.0.1", "老咪", "123", "test-code");
  assert.equal(short.status, 400);

  const ok = await register("10.0.0.1", "老咪", "test-password-123", "test-code");
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { token: string; username: string };
  assert.ok(typeof body.token === "string" && body.token.length > 20);
  assert.equal(body.username, "老咪");
  token = body.token;

  const dup = await register("10.0.0.2", "老咪", "another-pass-1", "test-code");
  assert.equal(dup.status, 409);
});

test("登录：错误密码 401，正确返回 token；账号名大小写不敏感", async () => {
  const wrong = await login("10.0.0.3", "老咪", "wrong-password");
  assert.equal(wrong.status, 401);

  const right = await login("10.0.0.3", "老咪", "test-password-123");
  assert.equal(right.status, 200);
  const body = (await right.json()) as { token: string };
  assert.ok(typeof body.token === "string" && body.token.length > 20);
});

test("第二账号注册与数据隔离", async () => {
  const ok = await register("10.0.0.4", "family", "family-pass-123", "test-code");
  assert.equal(ok.status, 200);
  tokenB = ((await ok.json()) as { token: string }).token;
  assert.notEqual(tokenA(), tokenB);

  // A 写入一条计划，B 拉取不到
  const post = await fetch(`${base}/api/data`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      data: {
        version: 2,
        plans: [
          {
            id: "p1",
            date: "2026-09-20",
            text: "出发去衢州",
            done: false,
            doneAt: null,
            createdAt: 1,
            domain: "life",
          },
        ],
        notes: [],
        habits: [],
        anniversaries: [],
      },
    }),
  });
  assert.equal(post.status, 200);

  const gotA = (await (
    await fetch(`${base}/api/data`, { headers: { authorization: `Bearer ${token}` } })
  ).json()) as { data: { plans: Array<{ text: string }> } };
  assert.equal(gotA.data.plans.length, 1);

  const gotB = (await (
    await fetch(`${base}/api/data`, { headers: { authorization: `Bearer ${tokenB}` } })
  ).json()) as { data: { plans: unknown[] } };
  assert.deepEqual(gotB.data.plans, []);

  // B 写入自己的数据，A 不受影响
  const postB = await fetch(`${base}/api/data`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({
      data: {
        version: 2,
        plans: [
          {
            id: "b1",
            date: "2026-09-20",
            text: "家人计划",
            done: false,
            doneAt: null,
            createdAt: 1,
            domain: "life",
          },
        ],
        notes: [],
        habits: [],
        anniversaries: [],
      },
    }),
  });
  assert.equal(postB.status, 200);
  const againA = (await (
    await fetch(`${base}/api/data`, { headers: { authorization: `Bearer ${token}` } })
  ).json()) as { data: { plans: Array<{ text: string }> } };
  assert.equal(againA.data.plans[0].text, "出发去衢州");
});

/** 返回主测试账号的登录令牌。 */
function tokenA() {
  return token;
}

test("首个账号自动继承旧版 data.json", async () => {
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "cal-sync-legacy-"));
  fs.writeFileSync(
    path.join(tmp2, "data.json"),
    JSON.stringify({
      version: 42,
      data: {
        version: 2,
        plans: [
          {
            id: "old1",
            date: "2026-09-16",
            text: "旧数据",
            done: true,
            doneAt: 5,
            createdAt: 1,
            domain: "life",
          },
        ],
        notes: [],
        habits: [],
        anniversaries: [],
      },
    }),
  );
  const app2 = serve({
    fetch: createApp({ ...config, dataDir: tmp2 }).fetch,
    port: 0,
  });
  const addr = app2.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const base2 = `http://localhost:${port}`;

  const reg = await fetch(`${base2}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "migrator", password: "migrate-pass-1", code: "test-code" }),
  });
  assert.equal(reg.status, 200);
  const t = ((await reg.json()) as { token: string }).token;
  const pulled = (await (
    await fetch(`${base2}/api/data`, { headers: { authorization: `Bearer ${t}` } })
  ).json()) as { version: number; data: { plans: Array<{ text: string }> } };
  assert.equal(pulled.version, 42);
  assert.equal(pulled.data.plans[0].text, "旧数据");

  app2.close();
  fs.rmSync(tmp2, { recursive: true, force: true });
});

test("POST 非法内容被清洗，不会写坏数据文件", async () => {
  const post = await fetch(`${base}/api/data`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: { plans: "garbage", habits: [{ text: 123 }] } }),
  });
  assert.equal(post.status, 200);
  const body = (await post.json()) as { data: { plans: unknown[]; habits: unknown[] } };
  assert.equal(body.data.plans.length, 1, "非法上传不能擦除已有计划");
  assert.deepEqual(body.data.habits, []);
});

test("伪造 token 返回 401", async () => {
  const res = await fetch(`${base}/api/data`, {
    headers: { authorization: "Bearer fake.token" },
  });
  assert.equal(res.status, 401);
});

test("限速：同一 IP 第 6 次登录尝试被 429 拒绝", async () => {
  const ip = "10.9.9.9";
  for (let i = 0; i < 5; i++) {
    const res = await login(ip, "老咪", "whatever-wrong");
    assert.equal(res.status, 401);
  }
  const blocked = await login(ip, "老咪", "whatever-wrong");
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});

test("绑定分享：保存时分发到对方账号，取消绑定打墓碑，对方删除不复活", async () => {
  // 老咪(token) 把 p1 分享给 family(tokenB)
  const post = await fetch(`${base}/api/data`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      data: {
        version: 2,
        plans: [
          {
            id: "sp1",
            date: "2026-10-01",
            text: "一起去衢州",
            done: false,
            doneAt: null,
            createdAt: 1,
            domain: "life",
            shareWith: ["family"],
          },
        ],
        notes: [
          {
            id: "sn1",
            date: "2026-10-01",
            text: "买票了",
            createdAt: 1,
            domain: "life",
            shareWith: ["family"],
          },
        ],
        habits: [],
        anniversaries: [],
      },
    }),
  });
  assert.equal(post.status, 200);

  // family 拉取：收到带 sharedBy 的副本
  const gotB = (await (
    await fetch(`${base}/api/data`, { headers: { authorization: `Bearer ${tokenB}` } })
  ).json()) as {
    data: {
      plans: Array<{ id: string; sharedBy?: string }>;
      notes: Array<{ id: string; sharedBy?: string }>;
    };
  };
  const sharedPlan = gotB.data.plans.find((p) => p.id === "sp1@老咪");
  assert.ok(sharedPlan, "应收到分享的计划副本");
  assert.equal(sharedPlan.sharedBy, "老咪");
  assert.equal(gotB.data.notes.find((n) => n.id === "sn1@老咪")?.sharedBy, "老咪");

  // 账号列表接口（含昵称）+ 昵称修改
  const accountsRes = await fetch(`${base}/api/accounts`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const accounts = (await accountsRes.json()) as {
    users: Array<{ username: string; nickname: string | null }>;
    self: { username: string };
  };
  assert.ok(
    accounts.users.some((u) => u.username === "老咪") &&
      accounts.users.some((u) => u.username === "family"),
  );
  assert.equal(accounts.self.username, "老咪");
  const nick = await fetch(`${base}/api/profile`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ nickname: "咪哥" }),
  });
  assert.equal(nick.status, 200);
  const accounts2 = (await (
    await fetch(`${base}/api/accounts`, { headers: { authorization: `Bearer ${token}` } })
  ).json()) as { users: Array<{ username: string; nickname: string | null }> };
  assert.equal(accounts2.users.find((u) => u.username === "老咪")?.nickname, "咪哥");

  // family 删除收到的副本 → 服务端不该复活它（老咪再次保存）
  const delB = await fetch(`${base}/api/data`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({
      data: {
        version: 2,
        plans: [
          {
            id: "sp1@老咪",
            date: "2026-10-01",
            text: "一起去衢州",
            done: false,
            doneAt: null,
            createdAt: 1,
            domain: "life",
            updatedAt: 1,
            deletedAt: 9999999999999,
            sharedBy: "老咪",
          },
        ],
        notes: [
          {
            id: "sn1@老咪",
            date: "2026-10-01",
            text: "买票了",
            createdAt: 1,
            domain: "life",
            updatedAt: 1,
            sharedBy: "老咪",
          },
        ],
        habits: [],
        anniversaries: [],
      },
    }),
  });
  assert.equal(delB.status, 200);
  await fetch(`${base}/api/data`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      data: {
        version: 2,
        plans: [
          {
            id: "sp1",
            date: "2026-10-01",
            text: "一起去衢州(改)",
            done: false,
            doneAt: null,
            createdAt: 1,
            domain: "life",
            updatedAt: 5,
            shareWith: ["family"],
          },
        ],
        notes: [],
        habits: [],
        anniversaries: [],
      },
    }),
  });
  const gotB2 = (await (
    await fetch(`${base}/api/data`, { headers: { authorization: `Bearer ${tokenB}` } })
  ).json()) as { data: { plans: Array<{ id: string; deletedAt: number | null }> } };
  const afterDel = gotB2.data.plans.find((p) => p.id === "sp1@老咪");
  assert.ok(afterDel && afterDel.deletedAt !== null, "对方删除过的副本不应复活");

  // 老咪取消绑定 → family 侧对应活副本被打墓碑
  await fetch(`${base}/api/data`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      data: {
        version: 2,
        notes: [
          {
            id: "sn1",
            date: "2026-10-01",
            text: "买票了",
            createdAt: 1,
            domain: "life",
            updatedAt: 9,
          },
        ],
        plans: [],
        habits: [],
        anniversaries: [],
      },
    }),
  });
  const gotB3 = (await (
    await fetch(`${base}/api/data`, { headers: { authorization: `Bearer ${tokenB}` } })
  ).json()) as { data: { notes: Array<{ id: string; deletedAt: number | null }> } };
  const noteAfter = gotB3.data.notes.find((n) => n.id === "sn1@老咪");
  assert.ok(noteAfter && noteAfter.deletedAt !== null, "取消绑定后对方副本应被打墓碑");
});

test("过期设备上传保留其他设备新增内容及更新后的分享副本 ID", async () => {
  /** 使用给定测试令牌读取对应账号的云端日历数据。 */
  const pull = async (t: string) =>
    (await (
      await fetch(base + "/api/data", { headers: { authorization: "Bearer " + t } })
    ).json()) as { data: import("../../src/lib/types.ts").AppData };
  /** 以测试账号上传日历快照，确认成功后读取服务端合并结果。 */
  const push = async (t: string, data: unknown) => {
    const res = await fetch(base + "/api/data", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + t },
      body: JSON.stringify({ data }),
    });
    assert.equal(res.status, 200);
    return (await res.json()) as { data: import("../../src/lib/types.ts").AppData };
  };
  const stale = (await pull(token)).data;
  const now = Date.now();
  /** 构造测试用计划数据。 */
  const plan = (id: string) => ({
    id,
    date: "2026-09-24",
    text: id,
    done: false,
    doneAt: null,
    createdAt: now,
    domain: "life" as const,
    updatedAt: now,
    deletedAt: null,
  });
  await push(token, { ...stale, plans: [...stale.plans, plan("device-a")] });
  const merged = await push(token, { ...stale, plans: [...stale.plans, plan("device-b")] });
  assert.ok(merged.data.plans.some((p) => p.id === "device-a"));
  assert.ok(merged.data.plans.some((p) => p.id === "device-b"));

  let owner = {
    ...merged.data,
    plans: [...merged.data.plans, { ...plan("share-update"), shareWith: ["family"] }],
    notes: [
      ...merged.data.notes,
      {
        id: "note-update",
        date: "2026-09-24",
        text: "original",
        createdAt: now,
        domain: "life" as const,
        updatedAt: now,
        deletedAt: null,
        shareWith: ["family"],
      },
    ],
  };
  await push(token, owner);
  owner = {
    ...owner,
    plans: owner.plans.map((p) =>
      p.id === "share-update" ? { ...p, text: "edited", updatedAt: now + 1 } : p,
    ),
    notes: owner.notes.map((n) =>
      n.id === "note-update" ? { ...n, text: "edited", updatedAt: now + 1 } : n,
    ),
  };
  await push(token, owner);
  let recipient = (await pull(tokenB)).data;
  assert.equal(recipient.plans.filter((p) => p.id === "share-update@老咪").length, 1);
  assert.equal(recipient.plans.find((p) => p.id === "share-update@老咪")?.text, "edited");
  assert.equal(recipient.notes.find((n) => n.id === "note-update@老咪")?.text, "edited");
  assert.ok(!recipient.plans.some((p) => p.id === "share-update"));
  assert.ok(!recipient.notes.some((n) => n.id === "note-update"));
  await push(token, {
    ...owner,
    plans: owner.plans.map((p) =>
      p.id === "share-update" ? { ...p, shareWith: [], updatedAt: now + 2 } : p,
    ),
    notes: owner.notes.map((n) =>
      n.id === "note-update" ? { ...n, shareWith: [], updatedAt: now + 2 } : n,
    ),
  });
  recipient = (await pull(tokenB)).data;
  assert.ok(recipient.plans.find((p) => p.id === "share-update@老咪")?.deletedAt);
  assert.ok(recipient.notes.find((n) => n.id === "note-update@老咪")?.deletedAt);
});
