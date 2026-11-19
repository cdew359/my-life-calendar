import assert from "node:assert/strict";
import { test } from "node:test";
import { nextHoliday } from "../src/lib/holidays.ts";

test("下一个假期：普通日取最近的假期首日", () => {
  // 2026-09-17 之后最近的是中秋 09-25
  const h = nextHoliday("2026-09-17");
  assert.equal(h?.name, "中秋节");
  assert.equal(h?.date, "2026-09-25");
  assert.equal(h?.days, 8);
  assert.equal(h?.ongoing, false);
});

test("假期进行中：days=0 且 ongoing", () => {
  const h = nextHoliday("2026-10-03");
  assert.equal(h?.name, "国庆节");
  assert.equal(h?.days, 0);
  assert.equal(h?.ongoing, true);
});

test("两个假期之间取更近的", () => {
  // 2026-02-24（春节结束后）之后最近的是清明 04-04
  const h = nextHoliday("2026-02-24");
  assert.equal(h?.name, "清明节");
});

test("数据未覆盖的远期年份返回 null", () => {
  assert.equal(nextHoliday("2028-05-01"), null);
});

test("年初取元旦", () => {
  const h = nextHoliday("2025-01-01");
  assert.equal(h?.name, "元旦");
  assert.equal(h?.ongoing, true);
});
