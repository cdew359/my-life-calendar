import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { coerceData } from "../../src/lib/validate.ts";
import { mergeUpload } from "../src/shared-merge.ts";
import { reconcile, type BothData, type MigrationDiary } from "../scripts/reconcile-shared.ts";

test("共享 SQL 使用同一组同步兼容用例，保护旧端时间线和生日字段", () => {
  const fixtures = JSON.parse(
    fs.readFileSync(
      new URL("../../cloud/calendar-service/src/test/resources/sync-parity.json", import.meta.url),
      "utf8",
    ),
  );
  for (const f of fixtures)
    assert.deepEqual(
      JSON.parse(JSON.stringify(mergeUpload(f.incoming, coerceData(f.current)))),
      f.expected,
      f.name,
    );
});
const account = { id: "a", username: "alice", hash: "hash", createdAt: 1 };
/** 构造正式版与 Cloud 版具有共同账号的迁移初始状态。 */
const initial = (): BothData => ({
  formal_accounts: [account],
  cloud_accounts: [account],
  baseline_accounts: [account],
  formal_states: {},
  cloud_states: {},
  formal_diaries: [],
  cloud_diaries: [],
  baseline_diaries: [],
});
/** 构造指定正文与版本的日记，供三方合并冲突测试使用。 */
const diary = (content: string, revision = 1): MigrationDiary => ({
  account_id: "a",
  diary_date: "2026-10-17",
  title: "日记",
  content,
  revision,
  created_at: 1,
  updated_at: 2,
  deleted: false,
});
test("日记只在一边修改时保留修改，双边冲突会中止而不覆盖正文", () => {
  const x = initial();
  x.baseline_diaries = [diary("base")];
  x.formal_diaries = [diary("base")];
  x.cloud_diaries = [diary("cloud", 2)];
  const merged = reconcile(x).diaries[0];
  assert.equal(merged.content, "cloud");
  assert.equal(merged.revision, 3);
  x.formal_diaries = [diary("formal", 2)];
  assert.throws(() => reconcile(x), /冲突/);
});
test("不同 ID 使用相同账号名时拒绝错误归并身份", () => {
  const x = initial();
  x.cloud_accounts = [{ ...account, id: "other" }];
  assert.throws(() => reconcile(x), /身份冲突/);
});
