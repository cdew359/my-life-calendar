import { aiRoutes } from "./ai-routes.ts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import bcrypt from "bcryptjs";
import type { Config } from "./config.js";
import { AccountBook } from "./accounts.js";
import { Store } from "./store.js";
import { diaryRoutes } from "./diary-routes.ts";
import type { DiaryService } from "./diary-service.ts";
import { coerceData } from "../../src/lib/validate.ts";
import { mergeData } from "../../src/lib/sync.ts";
import type { AppData, DayNote, Plan } from "../../src/lib/types.ts";
import { LoginRateLimiter, clientIp, createToken, verifyPassword, verifyToken } from "./auth.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

interface Shareable {
  id: string;
  deletedAt: number | null;
  updatedAt: number;
  shareWith?: string[];
}

/**
 * 分发绑定条目：把 owner 数据里 shareWith 含接收方的活条目，以 `原id@owner账号`
 * 的 id 写入接收方数据（带 sharedBy 标记）；owner 取消绑定或删除原条目时给
 * 对应副本打墓碑；接收方自己删过的副本不复活。
 */
export function mergeSharedInto<T extends Shareable>(
  ownerName: string,
  recipientName: string,
  ownerItems: T[],
  theirItems: Array<T & { sharedBy?: string }>,
): { list: Array<T & { sharedBy?: string }>; changed: boolean } {
  const now = Date.now();
  const wanted = new Map<string, T>();
  for (const item of ownerItems) {
    if (item.deletedAt === null && (item.shareWith ?? []).includes(recipientName)) {
      wanted.set(`${item.id}@${ownerName}`, item);
    }
  }

  const list = [...theirItems];
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item.sharedBy !== ownerName) continue;
    const share = wanted.get(item.id);
    if (!share) {
      if (item.deletedAt === null) {
        list[i] = { ...item, deletedAt: now, updatedAt: now };
        changed = true;
      }
    } else {
      wanted.delete(item.id);
      if (item.deletedAt !== null) continue; // 对方删过，不复活
      if (share.updatedAt > item.updatedAt) {
        list[i] = { ...share, id: item.id, shareWith: undefined, sharedBy: ownerName };
        changed = true;
      }
    }
  }
  for (const [id, share] of wanted) {
    list.push({ ...share, id, shareWith: undefined, sharedBy: ownerName });
    changed = true;
  }
  return { list, changed };
}

/** 组装文件存储模式的账号、鉴权、同步与可选日记 API。 */
export function createApp(config: Config, diary?: DiaryService) {
  const app = new Hono<{ Variables: { accountId: string } }>();
  const accounts = new AccountBook(config.dataDir);
  const stores = new Map<string, Store>();
  const limiter = new LoginRateLimiter();

  /** 按账号取得或创建独立文件存储实例，避免跨账号共用数据文件。 */
  const storeOf = (accountId: string): Store => {
    let store = stores.get(accountId);
    if (!store) {
      store = new Store(config.dataDir, accountId);
      stores.set(accountId, store);
    }
    return store;
  };

  // 桌面端（file:// 加载，Origin 为 null）跨源访问；数据仍需 Bearer token 鉴权
  app.use("/api/*", cors({ origin: "*" }));

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      capabilities: [
        "timelines-v1",
        "timelines-backward-v1",
        "timelines-goal-v1",
        "birthday-reminders-v1",
        ...(diary ? ["diary-v1"] : []),
      ],
    }),
  );

  // 注册：凭注册码开新账号；首个账号自动继承旧版单用户数据
  app.post("/api/register", async (c) => {
    const ip = clientIp(c);
    const gate = limiter.check(ip);
    if (!gate.allowed) {
      return c.json({ error: "尝试过于频繁，请稍后再试" }, 429, {
        "Retry-After": String(gate.retryAfterSec),
      });
    }
    let body: { username?: unknown; password?: unknown; code?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "请求格式错误" }, 400);
    }
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const code = typeof body.code === "string" ? body.code : "";
    const nickname =
      typeof (body as { nickname?: unknown }).nickname === "string"
        ? ((body as { nickname: unknown }).nickname as string)
        : "";
    if (code !== config.registerCode) {
      return c.json({ error: "注册码不正确" }, 403);
    }
    if (password.length < 6 || password.length > 64) {
      return c.json({ error: "密码需 6–64 位" }, 400);
    }
    const firstAccount = accounts.size === 0;
    let account;
    try {
      account = accounts.register(username, bcrypt.hashSync(password, 10), nickname);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "账号名不合法" }, 400);
    }
    if (!account) {
      return c.json({ error: "账号已存在" }, 409);
    }
    if (firstAccount) {
      Store.adoptLegacy(config.dataDir, account.id);
    }
    limiter.reset(ip);
    return c.json({
      token: createToken(config.secret, config.tokenDays, account.id),
      username: account.username,
    });
  });

  app.post("/api/login", async (c) => {
    const ip = clientIp(c);
    const gate = limiter.check(ip);
    if (!gate.allowed) {
      return c.json({ error: "尝试过于频繁，请稍后再试" }, 429, {
        "Retry-After": String(gate.retryAfterSec),
      });
    }

    let body: { username?: unknown; password?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "请求格式错误" }, 400);
    }
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const account = username ? accounts.find(username) : undefined;
    if (!account || !password || !(await verifyPassword(password, account.hash))) {
      return c.json({ error: "账号或密码错误" }, 401);
    }

    limiter.reset(ip);
    return c.json({
      token: createToken(config.secret, config.tokenDays, account.id),
      username: account.username,
    });
  });

  // 以下接口一律需要有效 token（按 token 里的账号 id 分库）
  app.use("/api/*", async (c, next) => {
    if (
      c.req.path === "/api/login" ||
      c.req.path === "/api/register" ||
      c.req.path === "/api/health"
    ) {
      return next();
    }
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const accountId = token ? verifyToken(config.secret, token) : null;
    if (!accountId || !accounts.byId(accountId)) {
      return c.json({ error: "未登录或登录已过期" }, 401);
    }
    c.set("accountId", accountId);
    return next();
  });

  app.route("/api/ai", aiRoutes());
  app.route("/api/diaries", diaryRoutes(diary));

  app.get("/api/accounts", (c) => {
    const self = accounts.byId(c.get("accountId"))!;
    return c.json({
      users: accounts.all().map((a) => ({ username: a.username, nickname: a.nickname ?? null })),
      self: { username: self.username, nickname: self.nickname ?? null },
    });
  });

  // 修改自己的昵称
  app.post("/api/profile", async (c) => {
    let body: { nickname?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "请求格式错误" }, 400);
    }
    const nickname = typeof body.nickname === "string" ? body.nickname : "";
    if (nickname.trim() && nickname.trim().length > 24) {
      return c.json({ error: "昵称最多 24 个字" }, 400);
    }
    accounts.setNickname(c.get("accountId"), nickname);
    return c.json({ ok: true, nickname: nickname.trim() || null });
  });

  app.get("/api/data", (c) => {
    return c.json(storeOf(c.get("accountId")).load());
  });

  app.post("/api/data", async (c) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > MAX_BODY_BYTES) {
      return c.json({ error: "数据过大" }, 413);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求格式错误" }, 400);
    }
    const payload = (body as { data?: unknown })?.data;
    if (!payload || typeof payload !== "object") {
      return c.json({ error: "缺少 data 字段" }, 400);
    }
    const account = accounts.byId(c.get("accountId"))!;
    // The synchronous read/merge/write includes the latest concurrent device upload.
    const store = storeOf(account.id);
    const current = store.load().data;
    const incoming = coerceData(payload);
    // A forward-only client must not reinterpret or overwrite an existing deadline.
    const rawLines = (payload as { timelines?: unknown[] }).timelines;
    incoming.timelines = incoming.timelines.map((t) => {
      const raw = Array.isArray(rawLines)
        ? (rawLines.find(
            (r) => r && typeof r === "object" && (r as { id?: string }).id === t.id,
          ) as { endTime?: string; stepsMode?: boolean; items?: { step?: unknown }[] } | undefined)
        : undefined;
      const stored = current.timelines.find((r) => r.id === t.id);
      if (
        stored &&
        (stored.stepsMode || stored.items.some((i) => i.step)) &&
        (!raw?.items?.some((i) => i.step) || (stored.stepsMode && raw.stepsMode !== true)) &&
        !(raw?.stepsMode === true && stored.stepsMode && raw.items?.length === 0)
      )
        return stored;
      return stored?.endTime !== undefined && raw?.endTime === undefined && t.deletedAt === null
        ? stored
        : t;
    });
    const state = store.save(mergeData(incoming, current));

    // 分发绑定：把分享给其他账号的条目写进对方数据文件
    for (const other of accounts.all()) {
      if (other.id === account.id) continue;
      const otherStore = storeOf(other.id);
      const theirs = otherStore.load();
      const plans = mergeSharedInto<Plan>(
        account.username,
        other.username,
        state.data.plans,
        theirs.data.plans,
      );
      const notes = mergeSharedInto<DayNote>(
        account.username,
        other.username,
        state.data.notes,
        theirs.data.notes,
      );
      if (plans.changed || notes.changed) {
        otherStore.save({ ...theirs.data, plans: plans.list, notes: notes.list } satisfies AppData);
      }
    }

    return c.json(state);
  });

  return app;
}
