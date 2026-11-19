import assert from "node:assert/strict";
import { test } from "node:test";
import { habitStreak, toggleCheckIn } from "../src/lib/habits.ts";
import type { Habit } from "../src/lib/types.ts";

/** 构造测试用习惯及打卡数据。 */
function habit(checkIns: string[]): Habit {
  return {
    id: "h1",
    text: "读书",
    domain: "life",
    createdAt: 0,
    archivedAt: null,
    checkIns,
    updatedAt: 0,
    deletedAt: null,
  };
}

test("连续打卡：今天已打，从今天倒数", () => {
  const h = habit(["2026-09-14", "2026-09-15", "2026-09-16"]);
  assert.equal(habitStreak(h, "2026-09-16"), 3);
});

test("连续打卡：今天未打不断签，从昨天倒数", () => {
  const h = habit(["2026-09-14", "2026-09-15"]);
  assert.equal(habitStreak(h, "2026-09-16"), 2);
});

test("连续打卡：中间断一天只算后面一段", () => {
  const h = habit(["2026-09-10", "2026-09-11", "2026-09-13", "2026-09-14", "2026-09-15"]);
  assert.equal(habitStreak(h, "2026-09-16"), 3);
});

test("连续打卡：从未打卡为 0", () => {
  assert.equal(habitStreak(habit([]), "2026-09-16"), 0);
});

test("toggleCheckIn 添加与移除，保持升序", () => {
  const h = habit(["2026-09-15"]);
  const added = toggleCheckIn(h, "2026-09-14");
  assert.deepEqual(added.checkIns, ["2026-09-14", "2026-09-15"]);
  const removed = toggleCheckIn(added, "2026-09-15");
  assert.deepEqual(removed.checkIns, ["2026-09-14"]);
});
