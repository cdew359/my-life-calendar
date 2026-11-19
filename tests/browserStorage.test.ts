import assert from "node:assert/strict";
import { test } from "node:test";
import { namespacedStorage } from "../src/lib/browserStorage.ts";

test("试运行的登录、日历和草稿不会读取或覆盖正式存储", (t) => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>([
    ["calendar.sync.token", "production-token"],
    ["calendar.data.v2", "production-calendar"],
    ["diary-draft", "production-draft"],
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      /** 读取指定键对应的存储值，键不存在时返回空值。 */
      getItem: (k: string) => values.get(k) ?? null,
      /** 保存指定键对应的字符串值。 */
      setItem: (k: string, v: string) => values.set(k, v),
      /** 移除指定键对应的存储值。 */
      removeItem: (k: string) => values.delete(k),
    },
  });
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const trial = namespacedStorage("calendar.cloud-trial.v1:"),
    production = namespacedStorage("");
  for (const key of ["calendar.sync.token", "calendar.data.v2", "diary-draft"]) {
    const original = production.getItem(key);
    assert.equal(trial.getItem(key), null);
    trial.setItem(key, "trial");
    assert.equal(trial.getItem(key), "trial");
    assert.equal(production.getItem(key), original);
    trial.removeItem(key);
    assert.equal(production.getItem(key), original);
  }
});
