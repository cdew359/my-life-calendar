import assert from "node:assert/strict";
import { test } from "node:test";
import { addMonths, buildMonthGrid, dateKey, mondayIndex, todayKey } from "../src/lib/dates.ts";

test("dateKey 补零并使用本地日期", () => {
  assert.equal(dateKey(new Date(2026, 8, 5)), "2026-09-05");
  assert.equal(dateKey(new Date(2026, 11, 31)), "2026-12-31");
  assert.equal(todayKey(), dateKey(new Date()));
});

test("mondayIndex 以周一为 0、周日为 6", () => {
  assert.equal(mondayIndex(new Date(2026, 8, 7)), 0); // 2026-09-07 周一
  assert.equal(mondayIndex(new Date(2026, 8, 6)), 6); // 2026-09-06 周日
  assert.equal(mondayIndex(new Date(2026, 8, 1)), 1); // 2026-09-01 周二
});

test("buildMonthGrid 固定 42 格、周一起始、跨月补齐", () => {
  const cells = buildMonthGrid(2026, 8); // 2026 年 9 月
  assert.equal(cells.length, 42);
  assert.equal(cells[0].key, "2026-08-31");
  assert.equal(cells[0].inMonth, false);
  assert.equal(cells[1].key, "2026-09-01");
  assert.equal(cells[1].inMonth, true);
  assert.equal(cells[30].key, "2026-09-30");
  assert.equal(cells.filter((c) => c.inMonth).length, 30);
});

test("addMonths 跨年回绕", () => {
  assert.deepEqual(addMonths(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(addMonths(2026, 11, 1), { year: 2027, month: 0 });
  assert.deepEqual(addMonths(2026, 8, 4), { year: 2027, month: 0 });
  assert.deepEqual(addMonths(2026, 8, -8), { year: 2026, month: 0 });
});
