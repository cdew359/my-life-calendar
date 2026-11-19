import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Context } from "hono";

/** 每 IP 每分钟最多 5 次登录尝试，超限锁定到窗口结束 */
export class LoginRateLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>();
  private readonly max = 5;
  private readonly windowMs = 60_000;

  /** 累计指定 IP 在当前时间窗口内的登录尝试，返回是否允许及剩余等待时间。 */
  check(ip: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const entry = this.attempts.get(ip);
    if (!entry || now >= entry.resetAt) {
      this.attempts.set(ip, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    entry.count += 1;
    if (entry.count > this.max) {
      return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  /** 清除指定 IP 的登录尝试计数。 */
  reset(ip: string) {
    this.attempts.delete(ip);
  }
}

// ── 无状态 token：payload.{acc, exp} + HMAC 签名，服务端无需存储 ──

/** 将二进制或文本转换为可放入令牌的 Base64URL 编码。 */
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** 为账号签发包含毫秒级到期时间和 HMAC-SHA256 签名的令牌。 */
export function createToken(secret: string, days: number, accountId: string): string {
  const payload = base64url(
    JSON.stringify({ acc: accountId, exp: Date.now() + days * 86_400_000 }),
  );
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** 校验签名与有效期，通过返回账号 id，否则 null */
export function verifyToken(secret: string, token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      acc?: unknown;
      exp?: unknown;
    };
    if (
      typeof parsed.acc !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= Date.now()
    ) {
      return null;
    }
    return parsed.acc;
  } catch {
    return null;
  }
}

/** 读取代理头中的第一个来源 IP，缺失时使用直连标识。 */
export function clientIp(c: Context): string {
  // nginx 反代后取 X-Forwarded-For 第一个地址
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "direct";
}

/** 使用 bcrypt 对照保存的哈希验证明文密码。 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
