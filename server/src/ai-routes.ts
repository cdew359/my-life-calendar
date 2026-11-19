import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createHash, createHmac } from "node:crypto";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface AiBridgeOptions {
  url?: string;
  secret?: string;
}
/** 签发绑定账号、用途和完整请求体的短期凭据，不复用正式登录令牌。 */
export function aiBridgeToken(
  secret: string,
  account: string,
  audience: string,
  body: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      account,
      audience,
      expires: Date.now() + 30000,
      digest: createHash("sha256").update(body).digest("hex"),
    }),
  ).toString("base64url");
  return payload + "." + createHmac("sha256", secret).update(payload).digest("base64url");
}
/** 限制内部返回体，避免异常响应无界占用 Node 内存。 */
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("EMPTY_AI_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 128 * 1024) throw new Error("AI_RESPONSE_TOO_LARGE");
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}
/** 在既有登录鉴权之后挂载；仅转发三个固定内部路径，不能作为任意 HTTP 代理。 */
export function aiRoutes(
  options: AiBridgeOptions = { url: process.env.AI_JAVA_URL, secret: process.env.AI_BRIDGE_SECRET },
) {
  const app = new Hono<{ Variables: { accountId: string } }>();
  app.use(
    "*",
    bodyLimit({
      maxSize: 16 * 1024,
      /** AI 输入无需沿用整个日历快照的上传上限。 */
      onError: (c) => c.json({ error: "AI 输入过长" }, 413),
    }),
  );
  for (const route of [
    {
      path: "/capabilities",
      target: "/internal/ai/capabilities",
      audience: "ai-capabilities",
      method: "GET",
    },
    {
      path: "/events/interpret",
      target: "/internal/ai/events/interpret",
      audience: "ai-events",
      method: "POST",
    },
    {
      path: "/knowledge/ask",
      target: "/internal/ai/knowledge/ask",
      audience: "ai-knowledge",
      method: "POST",
    },
  ]) {
    app.on(route.method, route.path, async (c) => {
      if (!options.url || !options.secret || options.secret.length < 32) {
        return route.method === "GET"
          ? c.json({ enabled: false, events: false, knowledge: false })
          : c.json({ error: "AI 尚未配置，可继续手动录入和搜索" }, 503);
      }
      let body = "{}";
      if (route.method === "POST") {
        try {
          const input: unknown = await c.req.json();
          if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
          body = JSON.stringify(input);
        } catch {
          return c.json({ error: "AI 请求格式错误" }, 400);
        }
      }
      try {
        const response = await fetch(options.url.replace(/\/+$/, "") + route.target, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-AI-Bridge-Token": aiBridgeToken(
              options.secret,
              c.get("accountId"),
              route.audience,
              body,
            ),
          },
          body,
          signal: AbortSignal.timeout(35000),
          redirect: "error",
        });
        const data = await boundedJson(response);
        if (!response.ok) {
          const error = (data as { error?: unknown })?.error;
          const status = [400, 409, 410, 429, 502, 503].includes(response.status)
            ? response.status
            : 503;
          return c.json(
            {
              error:
                typeof error === "string" && error.length <= 200
                  ? error
                  : "AI 暂不可用，可继续手动操作",
            },
            status as ContentfulStatusCode,
          );
        }
        return c.json(data as Record<string, unknown>);
      } catch {
        return route.method === "GET"
          ? c.json({ enabled: false, events: false, knowledge: false })
          : c.json({ error: "AI 暂不可用，原文已保留；请勿自动重复生成" }, 503);
      }
    });
  }
  return app;
}
