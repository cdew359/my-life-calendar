import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createHash, createHmac } from "node:crypto";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface AiBridgeOptions {
  /** 仅由后端环境配置的 Java 私网基址，不接受前端或模型传入任意目标 URL。 */
  url?: string;
  /** 与 Java 服务共享的专用 AI 签名密钥，至少32字符，不复用两套登录密钥。 */
  secret?: string;
}
/**
 * 为已完成 Node 登录鉴权的账号签发30秒有效凭据，协议与 Java AiBridgeTokens 对齐。
 * SHA-256 摘要绑定原始请求体，HMAC 签名绑定整个载荷；摘要本身不提供身份授权。
 * @param secret 后端 AI 专用密钥，不传给浏览器或模型
 * @param account 既有鉴权中间件取得的 accountId，不从用户 JSON 中读取
 * @param audience 本次接口用途，防止将计划提取凭据挪用到日记问答
 * @param body 即将转发的完整 JSON 字符串，签名后不得再改动
 * @returns 仅用于可信服务之间传递的短期签名字符串
 */
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
/**
 * 流式累计最多128KiB的内部响应后解析 JSON，防止异常返回体无界占用 Node 内存。
 * 无论解析成功或失败均取消读取；网络等待上限由调用处的 AbortSignal 配置。
 */
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
/**
 * 正式 Node 入口的 AI 路由，必须挂载在既有账号鉴权中间件之后。
 * 对外暴露能力检查、计划提取和日记问答三个固定路径；转发到 Java 时使用独立签名，
 * 不直接把 Node 登录令牌当作 Cloud 令牌使用，也不允许模型决定访问地址。
 * 未配置桥接时能力标记关闭，业务请求返回可理解的503，不影响原有录入与同步。
 * @param options Java 私网地址及专用密钥，默认从后端环境读取
 * @returns 在 /api/ai 下挂载的 Hono 子路由，不负责直接调用 DeepSeek
 */
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
