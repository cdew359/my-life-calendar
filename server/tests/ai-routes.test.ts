import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { Hono } from "hono";
import { aiBridgeToken, aiRoutes } from "../src/ai-routes";

const secret = "test-only-bridge-key-at-least-32-characters";
/** 建立带可信账号上下文的桥接入口。 */
function app(url?: string) {
  const api = new Hono<{ Variables: { accountId: string } }>();
  api.use("*", async (c, next) => {
    c.set("accountId", "real-account");
    await next();
  });
  api.route("/api/ai", aiRoutes({ url, secret }));
  return api;
}
test("桥接签名采用跨语言一致的原始载荷和 SHA-256 请求体摘要", () => {
  const body = '{"text":"明天开会"}';
  const [payload, signature] = aiBridgeToken(secret, "alice", "ai-events", body).split(".");
  assert.equal(signature, createHmac("sha256", secret).update(payload).digest("base64url"));
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.account, "alice");
  assert.equal(claims.audience, "ai-events");
  assert.equal(claims.digest, createHash("sha256").update(body).digest("hex"));
  assert.ok(claims.expires > Date.now() && claims.expires <= Date.now() + 30000);
});
test("未配置 AI 时提供关闭状态并保持错误可理解", async () => {
  assert.deepEqual(await (await app().request("/api/ai/capabilities")).json(), {
    enabled: false,
    events: false,
    knowledge: false,
  });
  assert.equal((await app().request("/api/ai/events/interpret", { method: "POST" })).status, 503);
});
test("桥接只签发鉴权账号，不信任客户端账号，并限制输入大小", async () => {
  const received: { path?: string; account?: string; audience?: string; valid?: boolean } = {};
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const [payload, signature] = String(req.headers["x-ai-bridge-token"]).split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    Object.assign(received, {
      path: req.url,
      account: claims.account,
      audience: claims.audience,
      valid:
        signature === createHmac("sha256", secret).update(payload).digest("base64url") &&
        claims.digest === createHash("sha256").update(body).digest("hex"),
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"requestId":"test"}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const api = app(`http://127.0.0.1:${address.port}`);
    const response = await api.request("/api/ai/events/interpret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "victim", text: "开会" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received, {
      path: "/internal/ai/events/interpret",
      account: "real-account",
      audience: "ai-events",
      valid: true,
    });
    assert.equal(
      (await api.request("/api/ai/events/interpret", { method: "POST", body: "[]" })).status,
      400,
    );
    assert.equal(
      (await api.request("/api/ai/events/interpret", { method: "POST", body: "x".repeat(17000) }))
        .status,
      413,
    );
    assert.equal((await api.request("/api/ai/arbitrary")).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
