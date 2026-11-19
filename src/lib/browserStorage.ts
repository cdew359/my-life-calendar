/** Cloud trial uses a separate namespace, so it cannot reuse production login or drafts. */
export function namespacedStorage(prefix: string) {
  return {
    /** 读取指定键对应的存储值，键不存在时返回空值。 */
    getItem(key: string) {
      return globalThis.localStorage.getItem(prefix + key);
    },
    /** 保存指定键对应的字符串值。 */
    setItem(key: string, value: string) {
      globalThis.localStorage.setItem(prefix + key, value);
    },
    /** 移除指定键对应的存储值。 */
    removeItem(key: string) {
      globalThis.localStorage.removeItem(prefix + key);
    },
  };
}
export const browserStorage = namespacedStorage(
  import.meta.env?.VITE_CLOUD_TRIAL === "true" ? "calendar.cloud-trial.v1:" : "",
);
