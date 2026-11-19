import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface Config {
  port: number;
  dataDir: string;
  /** 注册码：知道它才能在这台服务器上开新账号（防止陌生人占用） */
  registerCode: string;
  /** token 签名密钥（HMAC-SHA256） */
  secret: string;
  tokenDays: number;
  diaryDatabaseUrl?: string;
  elasticsearchUrl?: string;
  elasticsearchApiKey?: string;
}

/** 读取必需环境变量，允许使用显式默认值，缺失时终止启动。 */
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

/** 读取并校验运行配置；生产环境缺少必要凭据时拒绝启动。 */
export function loadConfig(): Config {
  const dataDir = path.resolve(required("DATA_DIR", path.join(process.cwd(), "data-dev")));
  fs.mkdirSync(dataDir, { recursive: true });

  let registerCode = process.env.REGISTER_CODE ?? "";
  if (!registerCode) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("生产环境必须通过 REGISTER_CODE 提供注册码");
    }
    registerCode = "dev-register";
    console.warn("[dev] 未设置 REGISTER_CODE，开发注册码为: dev-register");
  }

  return {
    port: Number(process.env.PORT ?? 8788),
    dataDir,
    registerCode,
    secret: process.env.SECRET ?? crypto.randomBytes(32).toString("hex"),
    tokenDays: Number(process.env.TOKEN_DAYS ?? 30),
  };
}
