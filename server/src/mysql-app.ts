import { aiRoutes } from "./ai-routes.ts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import bcrypt from "bcryptjs";
import type { Config } from "./config.ts";
import { MysqlRepository, InvalidAccountName } from "./mysql-repository.ts";
import { LoginRateLimiter, clientIp, createToken, verifyToken, verifyPassword } from "./auth.ts";
import { diaryRoutes, type DiaryApi } from "./diary-routes.ts";

/** 组装共享 MySQL 模式的账号、鉴权、日历同步和日记 API，保持原客户端协议。 */
export function createMysqlApp(config: Config, repository: MysqlRepository, diary: DiaryApi) {
  const app = new Hono<{ Variables: { accountId: string } }>(),
    limiter = new LoginRateLimiter();
  app.use("/api/*", cors({ origin: "*" }));
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      /** 在同步请求体超过大小限制时返回 413。 */
      onError: (c) => c.json({ error: "数据过大" }, 413),
    }),
  );
  app.onError((_error, c) => c.json({ error: "服务暂时不可用，请保留本地数据后重试" }, 503));
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      mode: "mysql-shared",
      capabilities: [
        "timelines-v1",
        "timelines-backward-v1",
        "timelines-goal-v1",
        "birthday-reminders-v1",
        "diary-v1",
        "shared-data-v1",
      ],
    }),
  );
  for (const route of ["/api/login", "/api/register"] as const)
    app.post(route, async (c) => {
      const ip = clientIp(c),
        gate = limiter.check(ip);
      if (!gate.allowed)
        return c.json({ error: "尝试过于频繁，请稍后再试" }, 429, {
          "Retry-After": String(gate.retryAfterSec),
        });
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
        if (!body || Array.isArray(body) || typeof body !== "object") throw Error();
      } catch {
        return c.json({ error: "请求格式错误" }, 400);
      }
      const username = typeof body.username === "string" ? body.username.trim() : "",
        password = typeof body.password === "string" ? body.password : "";
      let account;
      if (route === "/api/register") {
        if (body.code !== config.registerCode) return c.json({ error: "注册码不正确" }, 403);
        if (password.length < 6 || password.length > 64)
          return c.json({ error: "密码需 6–64 位" }, 400);
        try {
          account = await repository.register(
            username,
            bcrypt.hashSync(password, 10),
            typeof body.nickname === "string" ? body.nickname : "",
          );
        } catch (e) {
          if (e instanceof InvalidAccountName) return c.json({ error: e.message }, 400);
          throw e;
        }
        if (!account) return c.json({ error: "账号已存在" }, 409);
      } else {
        account = username ? await repository.find(username) : undefined;
        if (
          !account ||
          !password ||
          password.length > 64 ||
          !(await verifyPassword(password, account.hash))
        )
          return c.json({ error: "账号或密码错误" }, 401);
      }
      limiter.reset(ip);
      return c.json({
        token: createToken(config.secret, config.tokenDays, account.id),
        username: account.username,
      });
    });
  app.use("/api/*", async (c, next) => {
    const header = c.req.header("authorization") ?? "",
      id = header.startsWith("Bearer ") ? verifyToken(config.secret, header.slice(7)) : null;
    if (!id || !(await repository.byId(id))) return c.json({ error: "未登录或登录已过期" }, 401);
    c.set("accountId", id);
    return next();
  });
  app.route("/api/ai", aiRoutes());
  app.route("/api/diaries", diaryRoutes(diary));
  app.get("/api/accounts", async (c) => {
    const accounts = await repository.all(),
      self = accounts.find((a) => a.id === c.get("accountId"))!;
    return c.json({
      users: accounts.map((a) => ({ username: a.username, nickname: a.nickname ?? null })),
      self: { username: self.username, nickname: self.nickname ?? null },
    });
  });
  app.post("/api/profile", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
      if (!body || typeof body !== "object") throw Error();
    } catch {
      return c.json({ error: "请求格式错误" }, 400);
    }
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
    if (nickname.length > 24) return c.json({ error: "昵称最多 24 个字" }, 400);
    await repository.nickname(c.get("accountId"), nickname);
    return c.json({ ok: true, nickname: nickname || null });
  });
  app.get("/api/data", async (c) => c.json(await repository.load(c.get("accountId"))));
  app.post("/api/data", async (c) => {
    let body: { data?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求格式错误" }, 400);
    }
    if (!body?.data || typeof body.data !== "object" || Array.isArray(body.data))
      return c.json({ error: "缺少 data 字段" }, 400);
    return c.json(await repository.upload(c.get("accountId"), body.data));
  });
  return app;
}
