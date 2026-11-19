import assert from "node:assert/strict";
import { test } from "node:test";
import { foldCellContent } from "../src/lib/cellContent.ts";
import type { DayNote, Plan } from "../src/lib/types.ts";

/** 构造测试用计划数据。 */
function plan(id: string): Plan {
  return {
    id,
    date: "2026-09-17",
    text: `计划${id}`,
    done: false,
    doneAt: null,
    createdAt: 1,
    domain: "life",
    updatedAt: 1,
    deletedAt: null,
  };
}

/** 构造测试用每日记录。 */
function note(id: string): DayNote {
  return {
    id,
    date: "2026-09-17",
    text: `记录${id}`,
    createdAt: 1,
    domain: "life",
    updatedAt: 1,
    deletedAt: null,
  };
}

test("无记录：两条计划全显，与旧行为一致", () => {
  const r = foldCellContent([plan("a"), plan("b")], []);
  assert.equal(r.visible.length, 2);
  assert.equal(r.folded, 0);
});

test("有记录：第一条计划 + 第一条记录，其余折叠", () => {
  const r = foldCellContent([plan("a"), plan("b"), plan("c")], [note("n1"), note("n2")]);
  assert.deepEqual(
    r.visible.map((c) => c.kind),
    ["plan", "note"],
  );
  assert.equal(r.folded, 3); // 计划 b、c + 记录 n2
});

test("只有记录：显示两条记录", () => {
  const r = foldCellContent([], [note("n1"), note("n2"), note("n3")]);
  assert.deepEqual(
    r.visible.map((c) => c.kind),
    ["note", "note"],
  );
  assert.equal(r.folded, 1);
});

test("一条计划一条记录恰好占满", () => {
  const r = foldCellContent([plan("a")], [note("n1")]);
  assert.equal(r.visible.length, 2);
  assert.equal(r.folded, 0);
});
