import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SYNC_SERVER, upgradeSyncServer } from "../src/lib/config";
import { getSyncConfig } from "../src/lib/syncEngine";
test("仅将旧生产地址升级为正式 HTTPS 域名，保留自建服务", () => {
  assert.equal(DEFAULT_SYNC_SERVER, "https://cal.imlaomi.cn");
  assert.equal(upgradeSyncServer(" http://182.254.242.247:8080/ "), DEFAULT_SYNC_SERVER);
  assert.equal(upgradeSyncServer("https://custom.example/"), "https://custom.example");
  assert.equal(upgradeSyncServer("http://127.0.0.1:8788"), "http://127.0.0.1:8788");
});
test("恢复旧登录地址时保留原账号与令牌，并持久化 HTTPS 地址", (t) => {
  const values = new Map([
    ["calendar.sync.server", "http://182.254.242.247:8080"],
    ["calendar.sync.token", "test-existing-token"],
    ["calendar.sync.user", "existing-user"],
  ]);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      /** 读取指定键对应的存储值，键不存在时返回空值。 */
      getItem: (key: string) => values.get(key) ?? null,
      /** 保存指定键对应的字符串值。 */
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  assert.deepEqual(getSyncConfig(), {
    server: DEFAULT_SYNC_SERVER,
    token: "test-existing-token",
    username: "existing-user",
  });
  assert.equal(values.get("calendar.sync.server"), DEFAULT_SYNC_SERVER);
  assert.equal(values.get("calendar.sync.token"), "test-existing-token");
});
