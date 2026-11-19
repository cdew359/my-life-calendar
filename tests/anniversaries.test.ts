import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anniversaryOnDate,
  daysBetween,
  nextOccurrence,
  upcomingAnniversaries,
} from "../src/lib/anniversaries.ts";
import type { Anniversary } from "../src/lib/types.ts";

const TODAY = "2026-09-16";

const wedding: Anniversary = {
  id: "a1",
  name: "结婚纪念日",
  kind: "yearly",
  date: "2020-10-02",
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};
const trip: Anniversary = {
  id: "a2",
  name: "衢州出发",
  kind: "once",
  date: "2026-09-20",
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};
const past: Anniversary = {
  id: "a3",
  name: "已过的日子",
  kind: "once",
  date: "2026-01-01",
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};
const leap: Anniversary = {
  id: "a4",
  name: "闰日",
  kind: "yearly",
  date: "2024-02-29",
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};

test("yearly：今年还没到取今年", () => {
  assert.equal(nextOccurrence(wedding, TODAY), "2026-10-02");
});

test("yearly：今年已过取明年", () => {
  const birthday: Anniversary = {
    id: "x",
    name: "生日",
    kind: "yearly",
    date: "1995-03-01",
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
  assert.equal(nextOccurrence(birthday, TODAY), "2027-03-01");
});

test("yearly：当天即是", () => {
  const todayAnn: Anniversary = {
    id: "x",
    name: "中秋",
    kind: "yearly",
    date: "2000-09-16",
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
  assert.equal(nextOccurrence(todayAnn, TODAY), TODAY);
});

test("yearly：2/29 平年顺延到 3/1", () => {
  assert.equal(nextOccurrence(leap, TODAY), "2027-03-01");
});

test("once：未来返回原日期，过去返回 null", () => {
  assert.equal(nextOccurrence(trip, TODAY), "2026-09-20");
  assert.equal(nextOccurrence(past, TODAY), null);
});

test("daysBetween 跨月", () => {
  assert.equal(daysBetween(TODAY, "2026-09-20"), 4);
  assert.equal(daysBetween(TODAY, "2026-10-02"), 16);
  assert.equal(daysBetween(TODAY, TODAY), 0);
});

test("upcomingAnniversaries 按剩余天数排序并过滤过期", () => {
  const list = upcomingAnniversaries([past, wedding, trip], TODAY);
  assert.deepEqual(
    list.map((u) => u.name),
    ["衢州出发", "结婚纪念日"],
  );
  assert.equal(list[0].days, 4);
});

test("anniversaryOnDate：yearly 按月日、once 全等", () => {
  assert.equal(anniversaryOnDate([wedding], "2026-10-02"), "结婚纪念日");
  assert.equal(anniversaryOnDate([trip], "2026-09-20"), "衢州出发");
  assert.equal(anniversaryOnDate([trip], "2027-09-20"), null);
  assert.equal(anniversaryOnDate([wedding], "2026-10-03"), null);
});
