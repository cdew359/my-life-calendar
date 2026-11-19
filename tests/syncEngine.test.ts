import assert from "node:assert/strict";
import { test } from "node:test";
import { SyncEngine } from "../src/lib/syncEngine";
import { emptyData } from "../src/lib/validate";
import type { Plan } from "../src/lib/types";

test("提醒前同步等待落盘，复用正在进行的同步，并返回成功结果", async (t) => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      /** 读取指定键对应的存储值，键不存在时返回空值。 */
      getItem: (k: string) => values.get(k) ?? null,
      /** 保存指定键对应的字符串值。 */
      setItem: (k: string, v: string) => values.set(k, v),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  let local = emptyData();
  const remote = {
    ...emptyData(),
    plans: [
      {
        id: "cloud",
        text: "云端最新目标",
        date: "2026-10-16",
        createdAt: 2,
        updatedAt: 2,
        deletedAt: null,
        done: false,
        doneAt: null,
        domain: "life" as const,
      },
    ],
  };
  let release!: () => void, applied!: () => void;
  const disk = new Promise<void>((r) => {
    release = r;
  });
  const started = new Promise<void>((r) => {
    applied = r;
  });
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    assert.ok(init?.signal, "同步请求必须有超时信号");
    requests.push(init?.method ?? "GET");
    return Response.json({ version: 1, data: remote });
  });
  const engine = new SyncEngine({
    /** 取得当前账号最新的本地数据快照。 */
    getLocal: () => local,
    /** 将同步得到的数据快照应用到本地。 */
    apply: async (next) => {
      applied();
      await disk;
      local = next;
    },
    /** 将同步引擎的最新状态通知界面。 */
    onStatus: () => {},
  });
  engine.enable("https://calendar.test", "test-token");
  await started;
  const first = engine.syncOnce(),
    second = engine.syncOnce();
  assert.equal(first, second);
  assert.deepEqual(requests, ["GET"]);
  release();
  assert.equal(await first, true);
  assert.deepEqual(requests, ["GET", "POST"]);
  assert.equal(local.plans[0].text, "云端最新目标");
});

test("有时间线时拒绝向旧服务端上传，保留本机数据并提示升级", async (t) => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      /** 读取指定键对应的存储值，键不存在时返回空值。 */
      getItem: (k: string) => values.get(k) ?? null,
      /** 保存指定键对应的字符串值。 */
      setItem: (k: string, v: string) => values.set(k, v),
      /** 移除指定键对应的存储值。 */
      removeItem: (k: string) => values.delete(k),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const local = {
    ...emptyData(),
    timelines: [
      {
        id: "t",
        name: "计划",
        date: "2026-10-07",
        startTime: "09:00",
        endTime: "09:00",
        items: [],
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      },
    ],
  };
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown) => {
    urls.push(String(url));
    return Response.json({ ok: true, capabilities: ["timelines-v1"] });
  });
  let finish!: () => void;
  const finished = new Promise<void>((r) => {
    finish = r;
  });
  let message = "";
  const engine = new SyncEngine({
    /** 取得当前账号最新的本地数据快照。 */
    getLocal: () => local,
    /** 将同步得到的数据快照应用到本地。 */
    apply: () => assert.fail("旧服务端不应修改本机排程"),
    /** 将同步引擎的最新状态通知界面。 */
    onStatus: (s) => {
      if (s.state === "error") {
        message = s.message ?? "";
        finish();
      }
    },
  });
  engine.enable("https://calendar.test", "token");
  await finished;
  assert.match(message, /更新服务端/);
  assert.deepEqual(urls, ["https://calendar.test/api/health"]);
  assert.equal(local.timelines.length, 1);
});

test("同步接收服务端合并结果，保留上传期间编辑，重复点击不并发上传", async (t) => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      /** 读取指定键对应的存储值，键不存在时返回空值。 */
      getItem: (k: string) => values.get(k) ?? null,
      /** 保存指定键对应的字符串值。 */
      setItem: (k: string, v: string) => values.set(k, v),
      /** 移除指定键对应的存储值。 */
      removeItem: (k: string) => values.delete(k),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  /** 构造测试用计划数据。 */
  const plan = (id: string, text: string, updatedAt: number): Plan => ({
    id,
    text,
    updatedAt,
    deletedAt: null,
    date: "2026-09-24",
    createdAt: 1,
    done: false,
    doneAt: null,
    domain: "life",
  });
  let local = { ...emptyData(), plans: [plan("local", "before", 1)] };
  let finishPush!: (r: Response) => void;
  let markStarted!: () => void;
  let markDone!: () => void;
  const started = new Promise<void>((r) => {
    markStarted = r;
  });
  const done = new Promise<void>((r) => {
    markDone = r;
  });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    requests++;
    if (init?.method === "POST") {
      markStarted();
      return new Promise<Response>((r) => {
        finishPush = r;
      });
    }
    return Response.json({ version: 0, data: emptyData() });
  });
  const engine = new SyncEngine({
    /** 取得当前账号最新的本地数据快照。 */
    getLocal: () => local,
    /** 将同步得到的数据快照应用到本地。 */
    apply: (d) => {
      local = d;
    },
    /** 将同步引擎的最新状态通知界面。 */
    onStatus: (s) => {
      if (s.lastSyncAt) markDone();
    },
  });
  engine.enable("https://calendar.test", "test-token", "tester");
  await started;
  local = { ...local, plans: [plan("local", "during-upload", 3)] };
  engine.forceSyncOnce();
  assert.equal(requests, 2);
  finishPush(
    Response.json({
      version: 1,
      data: {
        ...emptyData(),
        plans: [plan("local", "before", 1), plan("remote", "another-device", 2)],
      },
    }),
  );
  await done;
  assert.equal(local.plans.find((p) => p.id === "local")?.text, "during-upload");
  assert.equal(local.plans.find((p) => p.id === "remote")?.text, "another-device");
});
