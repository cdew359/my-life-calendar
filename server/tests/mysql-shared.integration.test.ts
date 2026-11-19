import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { mysqlPool, MysqlRepository } from "../src/mysql-repository.ts";
import { MysqlDiaryService } from "../src/mysql-diary.ts";
import { DiarySearchIndex } from "../src/diary-search.ts";
import { createMysqlApp } from "../src/mysql-app.ts";
import { DiaryConflict } from "../src/diary-store.ts";

const url = process.env.SHARED_MYSQL_TEST_URL;
test(
  "真实共享 MySQL / ES：并发、账号即时可见、日记版本锁与持久补偿",
  { skip: !url, timeout: 90000 },
  async () => {
    if (new URL(url!).pathname !== "/calendar_shared_test")
      throw Error("测试只能使用专用 calendar_shared_test 数据库");
    const pool = mysqlPool(url!),
      repository = new MysqlRepository(pool),
      index = new DiarySearchIndex(
        process.env.ELASTICSEARCH_URL!,
        undefined,
        "calendar-diaries-shared-test-" + Date.now(),
      );
    const diary = new MysqlDiaryService(pool, index);
    try {
      for (const service of ["user-service", "calendar-service", "diary-service"]) {
        const sql = fs.readFileSync(
          new URL(`../../cloud/${service}/src/main/resources/schema.sql`, import.meta.url),
          "utf8",
        );
        for (const statement of sql
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean))
          await pool.query(statement);
      }
      for (const table of [
        "cloud_diary_outbox",
        "cloud_diary_entries",
        "cloud_calendar_states",
        "cloud_accounts",
      ])
        await pool.query("DELETE FROM " + table);
      await repository.init();
      await diary.start();
      const config = {
        port: 0,
        dataDir: "/tmp/unused-shared-tests",
        registerCode: "test-only",
        secret: "shared-test-only-secret-32-characters",
        tokenDays: 1,
      };
      const nodeA = createMysqlApp(config, repository, diary),
        nodeB = createMysqlApp(config, new MysqlRepository(pool), diary);
      const a = (await (
        await nodeA.request("/api/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: "shared-test-a",
            password: "test-password",
            code: "test-only",
          }),
        })
      ).json()) as { token: string };
      const auth = { authorization: "Bearer " + a.token, "content-type": "application/json" };
      const logged = await nodeB.request("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "shared-test-a", password: "test-password" }),
      });
      assert.equal(logged.status, 200);
      /** 构造共享数据库集成测试使用的计划条目。 */
      const row = (id: string) => ({
        id,
        text: id,
        date: "2026-10-17",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
        done: false,
        doneAt: null,
        domain: "life",
      });
      const uploaded = await Promise.all(
        [nodeA, nodeB].map((app, i) =>
          app.request("/api/data", {
            method: "POST",
            headers: auth,
            body: JSON.stringify({ data: { plans: [row("plan-" + i)] } }),
          }),
        ),
      );
      assert.deepEqual(
        uploaded.map((r) => r.status),
        [200, 200],
      );
      const state = (await (await nodeA.request("/api/data", { headers: auth })).json()) as {
        data: { plans: unknown[] };
      };
      assert.equal(state.data.plans.length, 2);
      const owner = (await repository.find("shared-test-a"))!.id;
      const initial = await diary.store.write(owner, "2026-10-17", {
        title: "上海",
        content: "在上海人民广场读书",
        expectedRevision: 0,
      });
      assert.equal(initial.revision, 1);
      const competing = await Promise.allSettled([
        diary.store.write(owner, "2026-10-17", {
          title: "上海",
          content: "设备A",
          expectedRevision: 1,
        }),
        diary.store.write(owner, "2026-10-17", {
          title: "上海",
          content: "设备B",
          expectedRevision: 1,
        }),
      ]);
      assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        competing.filter((r) => r.status === "rejected" && r.reason instanceof DiaryConflict)
          .length,
        1,
      );
      await diary.flush();
      assert.equal((await diary.search(owner, { q: "上海", page: 1 })).items.length, 1);
      assert.equal((await diary.search("another-account", { q: "上海", page: 1 })).items.length, 0);
      const offline = new MysqlDiaryService(
        pool,
        new DiarySearchIndex("http://127.0.0.1:1", undefined, index.index),
      );
      await offline.store.write(owner, "2026-10-17", {
        title: "上海",
        content: "搜索故障仍保留上海日记",
        expectedRevision: 2,
      });
      await offline.flush();
      assert.equal((await diary.store.get(owner, "2026-10-17"))!.revision, 3);
      await diary.flush();
      assert.equal((await diary.search(owner, { q: "上海", page: 1 })).items[0].revision, 3);
      await diary.store.write(
        owner,
        "2026-10-17",
        { title: "", content: "", expectedRevision: 3 },
        true,
      );
      await diary.flush();
      assert.equal((await diary.search(owner, { q: "上海", page: 1 })).items.length, 0);
      assert.equal(
        (await nodeB.request("/api/diaries/entries/2026-10-17", { headers: auth })).status,
        200,
      );
      assert.equal((await nodeA.request("/api/data")).status, 401);
    } finally {
      await diary.close();
      for (const table of [
        "cloud_diary_outbox",
        "cloud_diary_entries",
        "cloud_calendar_states",
        "cloud_accounts",
      ])
        await pool.query("DELETE FROM " + table);
      await index.call("/" + index.index, "DELETE");
      await pool.end();
    }
  },
);
