import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import {
  changeTimeline,
  dayMinute,
  minuteLabel,
  onDay,
  schedule,
  validateTimeline,
} from "../src/lib/timelines";
import { coerceData, emptyData } from "../src/lib/validate";
import { mergeData, purgeDeleted } from "../src/lib/sync";
import type { Plan, Timeline } from "../src/lib/types";

/** 构造测试用计划数据。 */
const plan = (id: string): Plan => ({
  id,
  date: "2026-10-07",
  text: id,
  domain: "life",
  done: false,
  doneAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});
/** 构造测试用时间线与步骤数据。 */
const timeline = (id = "line"): Timeline => ({
  id,
  name: "晚间安排",
  date: "2026-10-07",
  startTime: "23:00",
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  items: [
    { id: "a", planId: "p1", durationMinutes: 90 },
    { id: "b", planId: "p2", durationMinutes: 20 },
  ],
});

test("累加时间并跨午夜展示，修改耗时只影响所属时间线", () => {
  const t = timeline();
  const plans = [plan("p1"), plan("p2")];
  const rows = schedule(t, plans);
  assert.equal(minuteLabel(rows[0].end, t.date), "次日 00:30");
  assert.equal(minuteLabel(rows[1].end, t.date), "次日 00:50");
  assert.ok(onDay(t, plans, "2026-10-08"));
  assert.ok(!onDay(t, plans, "2026-10-09"));
  const other = { ...timeline("other"), items: [] };
  const data = { ...emptyData(), plans, timelines: [t, other] };
  const next = changeTimeline(data, {
    timeline: { ...t, items: t.items.map((i) => ({ ...i, durationMinutes: 1 })) },
    expectedUpdatedAt: 1,
  });
  assert.deepEqual(
    next.timelines.find((x) => x.id === "other"),
    other,
  );
  assert.equal(
    minuteLabel(
      schedule(
        next.timelines.find((x) => x.id === t.id)!,
        plans,
      )[1].end,
      t.date,
    ),
    "23:02",
  );
});

test("午夜边界、跨年、闰日和跨多日均按日期计算", () => {
  const plans = [plan("p1")];
  const t = {
    ...timeline(),
    date: "2026-12-31",
    items: [{ id: "a", planId: "p1", durationMinutes: 60 }],
  };
  assert.equal(minuteLabel(schedule(t, plans)[0].end, t.date), "次日 00:00");
  assert.ok(!onDay(t, plans, "2027-01-01"), "午夜结束不重复显示到次日");
  t.items[0].durationMinutes = 1440 * 2 + 120;
  assert.equal(minuteLabel(schedule(t, plans)[0].end, t.date), "2027-01-03 01:00");
  assert.ok(onDay(t, plans, "2027-01-02"));
  assert.equal(dayMinute("2028-03-01") - dayMinute("2028-02-28"), 2880);
});

test("拒绝无效耗时和日期范围；旧数据、导出再导入保留时间线", () => {
  for (const durationMinutes of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() =>
      validateTimeline({ ...timeline(), items: [{ id: "a", planId: "p1", durationMinutes }] }),
    );
  }
  assert.throws(() => validateTimeline({ ...timeline(), date: "2026-02-30" }));
  assert.throws(() => validateTimeline({ ...timeline(), date: "9999-12-31", startTime: "23:59" }));
  assert.deepEqual(coerceData({ version: 2, plans: [] }).timelines, []);
  const backward = { ...timeline(), endTime: "23:00" };
  assert.deepEqual(
    coerceData(JSON.parse(JSON.stringify({ ...emptyData(), timelines: [backward] }))).timelines,
    [backward],
  );
});

test("完成状态引用计划；删除计划跳过耗时，移出或删时间线保留计划", () => {
  const t = timeline();
  const plans = [plan("p1"), { ...plan("p2"), done: true }];
  assert.ok(schedule(t, plans)[1].plan.done);
  assert.equal(schedule(t, plans)[1].durationMinutes, 20);
  const removed = schedule(t, [{ ...plans[0], deletedAt: 2 }, plans[1]]);
  assert.equal(minuteLabel(removed[0].start, t.date), "23:00");
  const data = { ...emptyData(), plans, timelines: [t] };
  assert.deepEqual(
    changeTimeline(data, { timeline: { ...t, items: [] }, expectedUpdatedAt: 1 }).plans,
    plans,
  );
  assert.deepEqual(
    changeTimeline(data, { timeline: { ...t, deletedAt: 2 }, expectedUpdatedAt: 1 }).plans,
    plans,
  );
});

test("原子新增计划与事项，拒绝过期编辑和重复关联，重复冲突可移出修复", () => {
  const t = { ...timeline(), items: [] };
  const data = { ...emptyData(), plans: [plan("p1")], timelines: [t] };
  const next = changeTimeline(data, {
    timeline: timeline(),
    expectedUpdatedAt: 1,
    newPlan: plan("p2"),
  });
  assert.equal(next.plans.length, 2);
  assert.equal(next.timelines[0].items.length, 2);
  assert.equal(data.plans.length, 1, "不修改输入数据");
  assert.throws(() => changeTimeline(next, { timeline: timeline(), expectedUpdatedAt: 1 }));
  assert.throws(() =>
    changeTimeline(next, { timeline: timeline("other"), expectedUpdatedAt: null }),
  );
  const duplicate = { ...timeline("other"), items: [timeline().items[0]] };
  const conflict = { ...next, timelines: [...next.timelines, duplicate] };
  assert.equal(
    changeTimeline(conflict, {
      timeline: { ...duplicate, items: [] },
      expectedUpdatedAt: 1,
    }).timelines.find((x) => x.id === "other")?.items.length,
    0,
  );
});

test("旧端缺字段和过期副本不会清空时间线，墓碑与分享写回保留字段", () => {
  const t = timeline();
  const data = { ...emptyData(), timelines: [t] };
  assert.deepEqual(mergeData(coerceData({ plans: [] }), data).timelines, [t]);
  const deleted = { ...t, updatedAt: 3, deletedAt: 3 };
  assert.equal(mergeData({ ...data, timelines: [deleted] }, data).timelines[0].deletedAt, 3);
  assert.deepEqual(purgeDeleted({ ...data, timelines: [deleted] }, 4).timelines, [deleted]);
});

test("Electron 与网页使用相同计算和校验模块", () => {
  const require = createRequire(import.meta.url);
  const desktop = require("../electron/timelines.cjs") as typeof import("../src/lib/timelines");
  const t = timeline();
  const plans = [plan("p1"), plan("p2")];
  assert.deepEqual(desktop.schedule(t, plans), schedule(t, plans));
  assert.deepEqual(
    desktop.changeTimeline(
      { ...emptyData(), plans, timelines: [t] },
      { timeline: { ...t, items: [] }, expectedUpdatedAt: 1 },
    ).plans,
    plans,
  );
  assert.throws(() =>
    desktop.validateTimeline({ ...t, items: [{ id: "a", planId: "p1", durationMinutes: 0 }] }),
  );
});

test("固定最终完成时间倒推；耗时、顺序与删除变化不移动目标", () => {
  const t = {
    ...timeline(),
    startTime: "18:00",
    endTime: "18:00",
    items: [
      { id: "a", planId: "p1", durationMinutes: 120 },
      { id: "b", planId: "p2", durationMinutes: 60 },
      { id: "c", planId: "p3", durationMinutes: 30 },
    ],
  };
  const plans = ["p1", "p2", "p3"].map(plan);
  const rows = schedule(t, plans);
  assert.deepEqual(
    rows.map((r) => [minuteLabel(r.start, t.date), minuteLabel(r.end, t.date)]),
    [
      ["14:30", "16:30"],
      ["16:30", "17:30"],
      ["17:30", "18:00"],
    ],
  );
  const edited = {
    ...t,
    items: t.items.map((i) => (i.id === "a" ? { ...i, durationMinutes: 180 } : i)),
  };
  assert.equal(minuteLabel(schedule(edited, plans)[0].start, t.date), "13:30");
  assert.equal(minuteLabel(schedule(edited, plans).at(-1)!.end, t.date), "18:00");
  const reordered = { ...t, items: [...t.items].reverse() };
  assert.equal(schedule(reordered, plans)[0].plan.id, "p3");
  assert.equal(minuteLabel(schedule(reordered, plans).at(-1)!.end, t.date), "18:00");
  const completed = plans.map((p) => ({ ...p, done: true }));
  assert.equal(schedule(t, completed)[0].start, rows[0].start);
  assert.equal(
    minuteLabel(
      schedule(
        t,
        plans.map((p) => (p.id === "p1" ? { ...p, deletedAt: 2 } : p)),
      )[0].start,
      t.date,
    ),
    "16:30",
  );
});

test("向前倒推跨年、多日、午夜边界和最早日期校验", () => {
  const t = {
    ...timeline(),
    date: "2027-01-01",
    endTime: "00:30",
    items: [{ id: "a", planId: "p1", durationMinutes: 90 }],
  };
  const plans = [plan("p1")];
  assert.equal(minuteLabel(schedule(t, plans)[0].start, t.date), "前日 23:00");
  assert.ok(onDay(t, plans, "2026-12-31"));
  const midnight = { ...t, endTime: "00:00", items: [{ ...t.items[0], durationMinutes: 60 }] };
  assert.ok(onDay(midnight, plans, "2026-12-31"));
  assert.equal(schedule(midnight, plans)[0].end, dayMinute("2027-01-01"));
  const multiday = { ...t, items: [{ ...t.items[0], durationMinutes: 3000 }] };
  assert.equal(minuteLabel(schedule(multiday, plans)[0].start, t.date), "2026-12-29 22:30");
  assert.throws(() => validateTimeline({ ...t, date: "0001-01-01", endTime: "00:00" }));
});

test("旧正排时间线转换为原结束时间的目标，活动事项、删除事项及完成状态保留", () => {
  const old = timeline();
  const plans = [plan("p1"), { ...plan("p2"), done: true }];
  const migrated = coerceData({ ...emptyData(), plans, timelines: [old] });
  assert.equal(migrated.timelines[0].date, "2026-10-08");
  assert.equal(migrated.timelines[0].endTime, "00:50");
  assert.deepEqual(schedule(migrated.timelines[0], migrated.plans), schedule(old, migrated.plans));
  const deleted = plans.map((p) => (p.id === "p1" ? { ...p, deletedAt: 2 } : p));
  const migratedDeleted = coerceData({ ...emptyData(), plans: deleted, timelines: [old] });
  assert.deepEqual(schedule(migratedDeleted.timelines[0], deleted), schedule(old, deleted));
  assert.deepEqual(coerceData(migrated), migrated, "迁移必须幂等");
  const desktop = createRequire(import.meta.url)(
    "../electron/timelines.cjs",
  ) as typeof import("../src/lib/timelines");
  assert.deepEqual(desktop.coerceTimelines([old], plans), migrated.timelines);
});
