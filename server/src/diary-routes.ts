import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { validDiaryDate, validateDiary, validateDiarySearch } from "../../src/lib/diary.ts";
import { DiaryConflict } from "./diary-store.ts";
import { DiarySearchUnavailable } from "./diary-search.ts";
import type { DiaryService } from "./diary-service.ts";
import type { DiaryStore } from "./diary-store.ts";
export type DiaryApi = {
  store: Pick<DiaryStore, "get" | "write">;
  /** 请求处理待提交的日记索引任务。 */
  flush(): Promise<void>;
  search: DiaryService["search"];
};
type Env = { Variables: { accountId: string } };
/** 组装账号隔离的日记读写、删除和关键词搜索路由，并统一校验输入与错误响应。 */
export function diaryRoutes(service?: DiaryApi) {
  const app = new Hono<Env>();
  app.use(
    "*",
    bodyLimit({
      maxSize: 128 * 1024,
      /** 在日记请求体超过大小限制时返回 413。 */
      onError: (c) => c.json({ error: "日记内容过大" }, 413),
    }),
  );
  app.use("*", async (c, next) => {
    if (!service) return c.json({ error: "日记服务尚未配置" }, 503);
    return next();
  });
  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof DiaryConflict || error instanceof DiarySearchUnavailable
            ? error.message
            : "日记服务暂时不可用，草稿已保留，请稍后重试",
      },
      error instanceof DiaryConflict ? 409 : 503,
    ),
  );
  app.get("/search", async (c) => {
    let input;
    try {
      input = validateDiarySearch({
        q: c.req.query("q") ?? "",
        from: c.req.query("from") || undefined,
        to: c.req.query("to") || undefined,
        page: Number(c.req.query("page") ?? 1),
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    return c.json(await service!.search(c.get("accountId"), input));
  });
  app.get("/entries/:date", async (c) => {
    const date = c.req.param("date");
    if (!validDiaryDate(date)) return c.json({ error: "日期无效" }, 400);
    const entry = await service!.store.get(c.get("accountId"), date);
    return c.json({ entry: entry?.deleted ? null : entry, revision: entry?.revision ?? 0 });
  });
  app.put("/entries/:date", async (c) => {
    const date = c.req.param("date");
    if (!validDiaryDate(date)) return c.json({ error: "日期无效" }, 400);
    let input;
    try {
      input = validateDiary(await c.req.json());
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    const entry = await service!.store.write(c.get("accountId"), date, input);
    void service!.flush();
    return c.json({ entry, searchPending: true });
  });
  app.delete("/entries/:date", async (c) => {
    const date = c.req.param("date");
    if (!validDiaryDate(date)) return c.json({ error: "日期无效" }, 400);
    let revision: number;
    try {
      const body = await c.req.json();
      revision = body.expectedRevision;
      if (!Number.isSafeInteger(revision) || revision < 1) throw Error();
    } catch {
      return c.json({ error: "删除版本号无效" }, 400);
    }
    const entry = await service!.store.write(
      c.get("accountId"),
      date,
      { title: "", content: "", expectedRevision: revision },
      true,
    );
    void service!.flush();
    return c.json({ revision: entry.revision });
  });
  return app;
}
