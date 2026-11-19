import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import DiaryPanel from "../../src/components/DiaryPanel";
import "../../src/styles.css";
import "../../src/storybook.css";
// In-memory UI fixture. No real account, local storage or ES connection is used here.
const memory = new Map([
  ["calendar.sync.server", "https://diary-fixture.invalid"],
  ["calendar.sync.user", "sample"],
  ["calendar.sync.token", "fake-fixture-token"],
]);
Object.defineProperty(window, "localStorage", {
  value: {
    /** 读取指定键对应的存储值，键不存在时返回空值。 */
    getItem: (key: string) => memory.get(key) ?? null,
    /** 保存指定键对应的字符串值。 */
    setItem: (key: string, value: string) => memory.set(key, value),
    /** 移除指定键对应的存储值。 */
    removeItem: (key: string) => memory.delete(key),
  },
});
let entry = {
  date: "2026-10-15",
  title: "秋天里的小事",
  content: "今天去上海公园散步。\n路边的树叶变成了金黄色，回家后读了几页书。",
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  deleted: false,
};
const original = window.fetch;
window.fetch = async (url, options) => {
  const target = String(url);
  if (!target.startsWith("https://diary-fixture.invalid")) return original(url, options);
  if (target.includes("/search?")) {
    const q = new URL(target).searchParams.get("q") ?? "";
    const items = !entry.deleted && (entry.title + entry.content).includes(q) ? [entry] : [];
    return Response.json({ items, total: items.length, page: 1, pageSize: 20, indexing: false });
  }
  if (options?.method === "PUT") {
    const input = JSON.parse(String(options.body));
    if (input.expectedRevision !== entry.revision)
      return Response.json({ error: "日记已更新" }, { status: 409 });
    entry = { ...entry, ...input, revision: entry.revision + 1, deleted: false };
    return Response.json({ entry, searchPending: true });
  }
  if (options?.method === "DELETE") {
    entry = { ...entry, revision: entry.revision + 1, deleted: true };
    return Response.json({ revision: entry.revision });
  }
  return Response.json({ entry: entry.deleted ? null : entry, revision: entry.revision });
};
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="app">
      <h1>日记本 · 隔离样例</h1>
      <p>这是内存演示，不读取真实账号或日记。搜索演示使用样例数据，真实 ES 联调另有独立测试。</p>
      <DiaryPanel date="2026-10-15" />
    </main>
  </StrictMode>,
);
