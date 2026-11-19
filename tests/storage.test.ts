import assert from "node:assert/strict";
import { test } from "node:test";
import { coerceData, coerceLegacyPlans } from "../src/lib/storage.ts";

test("旧版 v1 计划（无 domain）迁移为生活域", () => {
  const legacy = [
    { id: "p1", date: "2026-09-20", text: "出发去衢州", done: false, doneAt: null, createdAt: 1 },
    { id: "p2", date: "2026-09-16", text: "贴毛毡板", done: true, doneAt: 2, createdAt: 3 },
  ];
  const plans = coerceLegacyPlans(legacy);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].domain, "life");
  assert.equal(plans[1].done, true);
});

test("非法实体被过滤，不阻塞加载", () => {
  const bad = [
    {
      id: "ok",
      date: "2026-09-20",
      text: "正常",
      done: false,
      doneAt: null,
      createdAt: 1,
      domain: "life",
    },
    {
      id: "bad-date",
      date: "2099-13-45",
      text: "非法日期",
      done: false,
      doneAt: null,
      createdAt: 1,
    },
    { id: "bad-text", date: "2026-09-20", text: "   ", done: false, doneAt: null, createdAt: 1 },
    "not an object",
  ];
  assert.equal(coerceLegacyPlans(bad).length, 1);
});

test("coerceData 完整结构与默认值", () => {
  const data = coerceData({
    plans: [
      {
        id: "p",
        date: "2026-09-20",
        text: "x",
        done: false,
        doneAt: null,
        createdAt: 1,
        domain: "work",
      },
    ],
    notes: [{ id: "n", date: "2026-09-20", text: "y", createdAt: 1 }],
    habits: [{ id: "h", text: "读书", checkIns: ["2026-09-15", "2026-09-14"], createdAt: 1 }],
    anniversaries: [{ id: "a", name: "纪念日", kind: "once", date: "2026-10-01", createdAt: 1 }],
    homeCity: { city: { name: "衢州", lat: 28.94, lon: 118.87 }, updatedAt: 123 },
    watchCity: { city: { name: "上海", lat: 31.23, lon: 121.47 }, updatedAt: 456 },
  });
  assert.equal(data.version, 2);
  assert.equal(data.plans[0].domain, "work");
  assert.equal(data.notes[0].domain, "life");
  assert.deepEqual(data.habits[0].checkIns, ["2026-09-14", "2026-09-15"]);
  assert.equal(data.habits[0].archivedAt, null);
  assert.equal(data.anniversaries[0].kind, "once");
  assert.deepEqual(data.homeCity, {
    city: { name: "衢州", lat: 28.94, lon: 118.87 },
    updatedAt: 123,
  });
  assert.deepEqual(data.watchCity, {
    city: { name: "上海", lat: 31.23, lon: 121.47 },
    updatedAt: 456,
  });
});

test("coerceData 对垃圾输入返回空结构", () => {
  const data = coerceData(null);
  assert.deepEqual(data, {
    version: 2,
    timelines: [],
    plans: [],
    notes: [],
    habits: [],
    anniversaries: [],
    reminders: [],
    homeCity: null,
    watchCity: null,
  });
});
