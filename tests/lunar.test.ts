import assert from "node:assert/strict";
import { test } from "node:test";
import { lunarFull, lunarLabel } from "../src/lib/lunar.ts";

// 锚点均经外部资料核实：2026 春节 2/17、立春 2/4、秋分 9/23（农历八月十三）、2025 闰六月

test("初一显示农历月名", () => {
  assert.deepEqual(lunarLabel(new Date(2026, 1, 17)), { text: "正月", kind: "month" });
});

test("闰月月初带闰字", () => {
  assert.deepEqual(lunarLabel(new Date(2025, 6, 25)), { text: "闰六月", kind: "month" });
});

test("节气当天优先显示节气", () => {
  assert.deepEqual(lunarLabel(new Date(2026, 1, 4)), { text: "立春", kind: "jieqi" });
  assert.deepEqual(lunarLabel(new Date(2026, 8, 23)), { text: "秋分", kind: "jieqi" });
});

test("普通日期显示农历日", () => {
  assert.deepEqual(lunarLabel(new Date(2026, 8, 16)), { text: "初六", kind: "day" });
  assert.deepEqual(lunarLabel(new Date(2026, 8, 22)), { text: "十二", kind: "day" });
});

test("日面板完整农历串", () => {
  assert.equal(lunarFull(new Date(2026, 8, 16)), "农历八月初六 · 丙午年");
  assert.equal(lunarFull(new Date(2026, 1, 17)), "农历正月初一 · 丙午年");
});
