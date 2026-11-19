import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDiary, validDiaryDate, validateDiarySearch } from "../src/lib/diary";
test("日记支持闰日和补写，拒绝无效日期", () => {
  assert.ok(validDiaryDate("2024-02-29"));
  assert.ok(validDiaryDate("2026-10-15"));
  for (const date of ["2026-02-29", "2026-13-01", "0000-01-01", "2026-1-1", "garbage"])
    assert.equal(validDiaryDate(date), false);
});
test("日记保存必须有正文和版本号，保留正文换行，不接收超长内容", () => {
  assert.deepEqual(
    validateDiary({ title: "  今天  ", content: "一行\n另一行", expectedRevision: 0 }),
    { title: "今天", content: "一行\n另一行", expectedRevision: 0 },
  );
  for (const data of [
    null,
    {},
    { title: "", content: " ", expectedRevision: 0 },
    { title: "a".repeat(101), content: "x", expectedRevision: 0 },
    { title: "", content: "x".repeat(20001), expectedRevision: 0 },
    { title: "", content: "x", expectedRevision: -1 },
  ])
    assert.throws(() => validateDiary(data));
});
test("查询检查关键词、日期范围和分页上限", () => {
  assert.equal(validateDiarySearch({ q: " 上海 ", page: 1 }).q, "上海");
  for (const input of [
    { q: " ", page: 1 },
    { q: "x".repeat(101), page: 1 },
    { q: "a", page: 0 },
    { q: "a", page: 101 },
    { q: "a", page: 1, from: "2026-10-20", to: "2026-10-01" },
  ])
    assert.throws(() => validateDiarySearch(input));
});
