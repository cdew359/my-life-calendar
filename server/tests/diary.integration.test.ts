import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DiaryStore, DiaryConflict } from "../src/diary-store.ts";
import { DiarySearchIndex, diarySearchBody } from "../src/diary-search.ts";
import { DiaryService } from "../src/diary-service.ts";
import { createApp } from "../src/app.ts";

test("ES 查询固定账号条件，关键词作为普通文本，不接受 DSL", () => {
  const body = diarySearchBody("account-a", {
    q: "上海 OR *",
    page: 2,
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.deepEqual(body.query.bool.filter.slice(0, 2), [
    { term: { accountId: "account-a" } },
    { term: { deleted: false } },
  ]);
  assert.equal(body.from, 20);
  assert.equal(body.query.bool.must[0].multi_match.query, "上海 OR *");
});
test(
  "真实 PostgreSQL / ES：账号隔离、中文检索、冲突、删除、故障补偿及接口鉴权",
  { skip: !process.env.DIARY_TEST_DATABASE_URL },
  async () => {
    assert.equal(
      new URL(process.env.DIARY_TEST_DATABASE_URL!).pathname,
      "/calendar_diary_test",
      "集成测试只能使用独立测试数据库",
    );
    const store = new DiaryStore(process.env.DIARY_TEST_DATABASE_URL!);
    const index = new DiarySearchIndex(
      process.env.ELASTICSEARCH_URL!,
      undefined,
      "calendar-diaries-test-" + crypto.randomBytes(8).toString("hex"),
    );
    const service = new DiaryService(store, index);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diary-api-"));
    await store.init();
    const a = "test-a-" + crypto.randomUUID(),
      b = "test-b-" + crypto.randomUUID(),
      date = "2026-10-15";
    try {
      const first = await store.write(a, date, {
        title: "上海旅行",
        content: "今天在上海公园散步，天气很好。",
        expectedRevision: 0,
      });
      assert.equal(first.revision, 1);
      assert.equal(await store.get(b, date), null);
      await assert.rejects(
        store.write(a, date, { title: "覆盖", content: "旧设备", expectedRevision: 0 }),
        DiaryConflict,
      );
      await store.write(b, date, { title: "别人的上海", content: "秘密正文", expectedRevision: 0 });
      await service.flush();
      const found = await service.search(a, { q: "上海", page: 1 });
      assert.equal(found.items.length, 1);
      assert.equal(found.items[0].title, "上海旅行");
      assert.equal((await service.search(a, { q: "秘密", page: 1 })).items.length, 0);
      assert.equal(
        (await service.search(a, { q: "上海", page: 1, from: "2026-10-16" })).items.length,
        0,
      );
      const changed = await store.write(a, date, {
        title: "读书",
        content: "今天读书，整理笔记。",
        expectedRevision: 1,
      });
      assert.equal(
        (await service.search(a, { q: "上海", page: 1 })).items.length,
        0,
        "旧索引命中不得展示已变更的正文",
      );
      await service.flush();
      await index.put({ ...first, accountId: a });
      assert.equal(
        (await service.search(a, { q: "读书", page: 1 })).items.length,
        1,
        "旧版本索引不能覆盖新正文",
      );
      const unavailable = new DiaryService(
        store,
        new DiarySearchIndex("http://127.0.0.1:1", undefined, index.index),
      );
      const pending = await store.write(a, "2026-10-16", {
        title: "明天",
        content: "明天继续读书",
        expectedRevision: 0,
      });
      await unavailable.flush();
      assert.equal((await store.get(a, pending.date))?.content, pending.content);
      assert.ok(
        Number(
          (
            await store.pool.query("SELECT count(*) FROM diary_index_outbox WHERE account_id=$1", [
              a,
            ])
          ).rows[0].count,
        ) > 0,
      );
      await service.flush();
      assert.equal((await service.search(a, { q: "继续", page: 1 })).items.length, 1);
      await store.write(
        a,
        date,
        { title: "", content: "", expectedRevision: changed.revision },
        true,
      );
      assert.equal(
        (await service.search(a, { q: "读书", page: 1, from: date, to: date })).items.length,
        0,
      );
      await service.flush();
      assert.equal(
        (await service.search(a, { q: "读书", page: 1, from: date, to: date })).items.length,
        0,
      );
      await index.call("/" + index.index, "DELETE");
      await store.reindex();
      await service.flush();
      assert.equal(
        (await service.search(a, { q: "继续", page: 1 })).items.length,
        1,
        "索引丢失后能由 SQL 完整重建",
      );
      const app = createApp(
        {
          port: 0,
          dataDir: dir,
          registerCode: "test-code",
          secret: "test-diary-secret",
          tokenDays: 1,
        },
        service,
      );
      assert.equal((await app.request("/api/diaries/entries/" + date)).status, 401);
      const reg = await app.request("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "diary-test",
          password: "test-password",
          code: "test-code",
        }),
      });
      assert.equal(reg.status, 200);
      const { token } = (await reg.json()) as { token: string };
      const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
      const response = await app.request("/api/diaries/entries/" + date, { headers });
      assert.equal(((await response.json()) as { entry: unknown }).entry, null);
      assert.equal(
        (
          await app.request("/api/diaries/entries/" + date, {
            method: "PUT",
            headers,
            body: JSON.stringify({
              title: "私人日记",
              content: "只属于自己",
              expectedRevision: 0,
              accountId: a,
            }),
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await app.request("/api/diaries/entries/" + date, {
            method: "PUT",
            headers,
            body: JSON.stringify({ title: "冲突", content: "旧版", expectedRevision: 0 }),
          })
        ).status,
        409,
      );
      assert.equal((await app.request("/api/diaries/search?q=&page=1", { headers })).status, 400);
      assert.equal((await app.request("/api/diaries/entries/2026-02-30", { headers })).status, 400);
      // The dedicated test database and uniquely named test index never touch production entries.
    } finally {
      await service.flush();
      await store.pool.query("TRUNCATE diary_index_outbox,diary_entries");
      await service.close();
      await index.call("/" + index.index, "DELETE");
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
