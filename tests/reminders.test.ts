import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeRule,
  nextFireDate,
  reminderAppliesOn,
  timeMinutes,
  weekdayOf,
} from "../src/lib/reminders.ts";
import type { Reminder } from "../src/lib/types.ts";

/** 构造测试用提醒规则。 */
function reminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: "r1",
    text: "喝水",
    time: "09:30",
    mode: "weekly",
    weekdays: [1, 2, 3, 4, 5],
    periodDays: 1,
    anchorDate: "2026-01-01",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    ...over,
  };
}

test("weekdayOf 周一=1 周日=7", () => {
  assert.equal(weekdayOf(new Date(2026, 8, 7)), 1); // 2026-09-07 周一
  assert.equal(weekdayOf(new Date(2026, 8, 6)), 7); // 2026-09-06 周日
});

test("weekly 模式按周几命中", () => {
  const workday = reminder(); // 工作日
  assert.equal(reminderAppliesOn(workday, "2026-09-17"), true); // 周四
  assert.equal(reminderAppliesOn(workday, "2026-09-19"), false); // 周六
  const weekend = reminder({ weekdays: [6, 7] });
  assert.equal(reminderAppliesOn(weekend, "2026-09-19"), true);
  assert.equal(reminderAppliesOn(weekend, "2026-09-17"), false);
});

test("periodic 模式：起算日与周期", () => {
  const r = reminder({ mode: "periodic", periodDays: 3, anchorDate: "2026-09-01" });
  assert.equal(reminderAppliesOn(r, "2026-09-01"), true);
  assert.equal(reminderAppliesOn(r, "2026-09-02"), false);
  assert.equal(reminderAppliesOn(r, "2026-09-04"), true);
  assert.equal(reminderAppliesOn(r, "2026-10-01"), true); // 30 天，3 的倍数
  assert.equal(reminderAppliesOn(r, "2026-08-31"), false); // 早于起算日
});

test("describeRule 预设与自选", () => {
  assert.equal(describeRule(reminder({ weekdays: [1, 2, 3, 4, 5, 6, 7] })), "每天");
  assert.equal(describeRule(reminder()), "工作日");
  assert.equal(describeRule(reminder({ weekdays: [6, 7] })), "周末");
  assert.equal(describeRule(reminder({ weekdays: [1, 3] })), "周一、周三");
  assert.equal(describeRule(reminder({ mode: "periodic", periodDays: 4 })), "每 4 天");
});

test("nextFireDate 找到下一个适用日", () => {
  const weekend = reminder({ weekdays: [6, 7] });
  // 2026-09-17 周四 → 下一个是 09-19 周六
  assert.equal(nextFireDate(weekend, "2026-09-17"), "2026-09-19");
  assert.equal(nextFireDate(weekend, "2026-09-19"), "2026-09-19");
  const daily = reminder({ weekdays: [1, 2, 3, 4, 5, 6, 7] });
  assert.equal(nextFireDate(daily, "2026-09-17"), "2026-09-17");
});

test("timeMinutes 解析", () => {
  assert.equal(timeMinutes("09:30"), 570);
  assert.equal(timeMinutes("23:59"), 1439);
  assert.equal(timeMinutes("00:00"), 0);
});
