import type { AppData } from "./types";

/** 服务器地址规整：去掉尾部斜杠，空串返回 null */
export function normalizeServer(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : null;
}

/** 向同步服务发送带令牌的 JSON 请求，并将失败状态转换为可读错误。 */
async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

/** 使用账号密码登录同步服务，取得后续请求所需的令牌。 */
export async function apiLogin(
  server: string,
  username: string,
  password: string,
): Promise<string> {
  const body = await request<{ token: string }>(`${server}/api/login`, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (!body.token) throw new Error("服务器响应异常");
  return body.token;
}

/** 注册并登录：注册码由服务器主人提供，首个账号会继承服务器旧数据 */
export async function apiRegister(
  server: string,
  username: string,
  password: string,
  code: string,
  nickname?: string,
): Promise<string> {
  const body = await request<{ token: string }>(`${server}/api/register`, {
    method: "POST",
    body: JSON.stringify({ username, password, code, nickname }),
  });
  if (!body.token) throw new Error("服务器响应异常");
  return body.token;
}

/** 读取当前账号的云端日历快照和版本。 */
export async function apiPull(
  server: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ version: number; data: AppData }> {
  return request(`${server}/api/data`, { token, signal });
}

/** 服务器上的账号列表（绑定分享时选择用）；self 是自己的账号信息 */
export interface AccountInfo {
  username: string;
  nickname: string | null;
}

/** 读取当前账号信息及可分享账号列表。 */
export async function apiAccounts(
  server: string,
  token: string,
): Promise<{ users: AccountInfo[]; self: AccountInfo | null }> {
  const body = await request<{ users?: AccountInfo[]; self?: AccountInfo }>(
    `${server}/api/accounts`,
    { token },
  );
  return { users: body.users ?? [], self: body.self ?? null };
}

/** 修改自己的昵称 */
export async function apiSetNickname(
  server: string,
  token: string,
  nickname: string,
): Promise<void> {
  await request(`${server}/api/profile`, {
    method: "POST",
    token,
    body: JSON.stringify({ nickname }),
  });
}

/** 上传本地日历快照，并接收服务端合并后的结果。 */
export async function apiPush(
  server: string,
  token: string,
  data: AppData,
  signal?: AbortSignal,
): Promise<{ version: number; data: AppData }> {
  return request(`${server}/api/data`, {
    method: "POST",
    token,
    body: JSON.stringify({ data }),
    signal,
  });
}
