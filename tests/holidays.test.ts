import assert from "node:assert/strict";
import { test } from "node:test";
import { holidayInfoOf, isChineseWorkday, nextHoliday } from "../src/lib/holidays.ts";
import { reminderAppliesOn } from "../src/lib/reminders.ts";
import type { Reminder } from "../src/lib/types.ts";

// 数据依据：国务院办公厅 2025 / 2026 / 2027 年部分节假日安排通知。
// 2027 年来源：国办发明电〔2026〕10号，2026-11-05 发布。

test("2026 放假日命中区间", () => {
  assert.deepEqual(holidayInfoOf("2026-10-01"), { kind: "holiday", name: "国庆节" });
  assert.deepEqual(holidayInfoOf("2026-02-15"), { kind: "holiday", name: "春节" });
  assert.deepEqual(holidayInfoOf("2026-02-23"), { kind: "holiday", name: "春节" });
  assert.deepEqual(holidayInfoOf("2026-09-25"), { kind: "holiday", name: "中秋节" });
});

test("2026 调休上班日", () => {
  assert.deepEqual(holidayInfoOf("2026-09-20"), { kind: "adjusted", name: "国庆调休" });
  assert.deepEqual(holidayInfoOf("2026-10-10"), { kind: "adjusted", name: "国庆调休" });
  assert.deepEqual(holidayInfoOf("2026-02-14"), { kind: "adjusted", name: "春节调休" });
});

test("普通日返回 null", () => {
  assert.equal(holidayInfoOf("2026-09-18"), null);
  assert.equal(holidayInfoOf("2026-02-24"), null);
  assert.equal(holidayInfoOf("2026-09-19"), null); // 周末但非假期
});

test("2025 年数据", () => {
  assert.deepEqual(holidayInfoOf("2025-01-28"), { kind: "holiday", name: "春节" }); // 除夕
  assert.deepEqual(holidayInfoOf("2025-01-26"), { kind: "adjusted", name: "春节调休" });
  assert.deepEqual(holidayInfoOf("2025-10-08"), { kind: "holiday", name: "国庆节·中秋" });
});

test("中国实际工作日判定", () => {
  assert.equal(isChineseWorkday("2026-09-18"), true); // 周五
  assert.equal(isChineseWorkday("2026-10-01"), false); // 国庆假
  assert.equal(isChineseWorkday("2026-10-10"), true); // 周六调休上班
  assert.equal(isChineseWorkday("2026-09-20"), true); // 周日调休上班
  assert.equal(isChineseWorkday("2026-09-19"), false); // 周末
  assert.equal(isChineseWorkday("2026-02-17"), false); // 春节（正月初一）
});

test("工作日预设提醒按实际工作日触发", () => {
  const workday: Reminder = {
    id: "w",
    text: "晨会",
    time: "09:00",
    mode: "weekly",
    weekdays: [1, 2, 3, 4, 5],
    periodDays: 1,
    anchorDate: "2026-01-01",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
  assert.equal(reminderAppliesOn(workday, "2026-09-17"), true); // 普通周四
  assert.equal(reminderAppliesOn(workday, "2026-10-01"), false); // 国庆假不提醒
  assert.equal(reminderAppliesOn(workday, "2026-09-20"), true); // 调休上班日照常提醒
});

test("自选周几不受假期影响（纯星期语义）", () => {
  const weekend: Reminder = {
    id: "e",
    text: "周末拉伸",
    time: "10:00",
    mode: "weekly",
    weekdays: [6],
    periodDays: 1,
    anchorDate: "2026-01-01",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
  assert.equal(reminderAppliesOn(weekend, "2026-10-03"), true); // 国庆假期中的周六，仍是周六
});

test("2027 年官方假期共 29 天，单日端午和中秋不扩展为连休", () => {
  const ranges = [
    ["2027-01-01", "2027-01-03", "元旦"],
    ["2027-02-05", "2027-02-13", "春节"],
    ["2027-04-03", "2027-04-05", "清明节"],
    ["2027-05-01", "2027-05-05", "劳动节"],
    ["2027-06-09", "2027-06-09", "端午节"],
    ["2027-09-15", "2027-09-15", "中秋节"],
    ["2027-10-01", "2027-10-07", "国庆节"],
  ];
  let holidays = 0;
  for (const [start, end, name] of ranges) {
    for (let day = start; day <= end;) {
      assert.deepEqual(holidayInfoOf(day), { kind: "holiday", name }, day);
      assert.equal(isChineseWorkday(day), false, day);
      holidays++;
      const date = new Date(day + "T12:00:00");
      date.setDate(date.getDate() + 1);
      day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
  }
  assert.equal(holidays, 29);
  for (const day of [
    "2027-02-04",
    "2027-05-06",
    "2027-06-08",
    "2027-06-10",
    "2027-09-14",
    "2027-09-16",
    "2027-10-08",
  ]) {
    assert.equal(holidayInfoOf(day), null, day);
    assert.equal(isChineseWorkday(day), true, day);
  }
});

test("2027 年五个周末调休均算工作日，普通周末保持休息", () => {
  for (const [day, name] of [
    ["2027-01-31", "春节调休"],
    ["2027-02-14", "春节调休"],
    ["2027-05-08", "劳动节调休"],
    ["2027-09-26", "国庆调休"],
    ["2027-10-09", "国庆调休"],
  ]) {
    assert.deepEqual(holidayInfoOf(day), { kind: "adjusted", name }, day);
    assert.equal(isChineseWorkday(day), true, day);
  }
  for (const day of ["2027-01-30", "2027-02-20", "2027-05-09", "2027-09-25", "2027-10-10"]) {
    assert.equal(holidayInfoOf(day), null, day);
    assert.equal(isChineseWorkday(day), false, day);
  }
});

test("假期倒计时跨入 2027 年，假期末日仍显示进行中，结束后跳到下一假期", () => {
  assert.deepEqual(nextHoliday("2026-12-31"), {
    name: "元旦",
    date: "2027-01-01",
    days: 1,
    ongoing: false,
  });
  assert.deepEqual(nextHoliday("2027-02-13"), {
    name: "春节",
    date: "2027-02-05",
    days: 0,
    ongoing: true,
  });
  assert.deepEqual(nextHoliday("2027-02-14"), {
    name: "清明节",
    date: "2027-04-03",
    days: 48,
    ongoing: false,
  });
  assert.equal(nextHoliday("2028-01-01"), null);
});

test("2027 年工作日提醒在补班周末触发，放假和普通周末不触发", () => {
  const workday: Reminder = {
    id: "w27",
    text: "上班提醒",
    time: "09:00",
    mode: "weekly",
    weekdays: [1, 2, 3, 4, 5],
    periodDays: 1,
    anchorDate: "2027-01-01",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
  for (const day of ["2027-01-31", "2027-02-14", "2027-05-08", "2027-09-26", "2027-10-09"]) {
    assert.equal(reminderAppliesOn(workday, day), true, day);
  }
  for (const day of ["2027-02-05", "2027-06-09", "2027-09-15", "2027-10-01", "2027-10-10"]) {
    assert.equal(reminderAppliesOn(workday, day), false, day);
  }
});
