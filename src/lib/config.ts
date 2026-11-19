/** 正式 HTTPS 同步地址；仅迁移本项目旧的生产地址，不改变自建服务。 */
export const DEFAULT_SYNC_SERVER = import.meta.env?.VITE_SYNC_SERVER || "https://cal.imlaomi.cn";
/** 把已知旧服务器地址升级为当前 HTTPS 地址，自定义地址保持原样。 */
export function upgradeSyncServer(server: string): string {
  const normalized = server.trim().replace(/\/+$/, "");
  return normalized === "http://182.254.242.247:8080" ? DEFAULT_SYNC_SERVER : normalized;
}
