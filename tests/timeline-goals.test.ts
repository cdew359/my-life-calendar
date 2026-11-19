import { test } from "node:test";
import assert from "node:assert/strict";
import { changeTimeline, schedule, minuteLabel, validateTimeline } from "../src/lib/timelines";
import { coerceData, emptyData } from "../src/lib/validate";
import { mergeData } from "../src/lib/sync";
import type { Plan, Timeline } from "../src/lib/types";
const p: Plan = {
  id: "step",
  text: "准备资料",
  date: "2026-10-13",
  domain: "work",
  done: false,
  doneAt: null,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const t: Timeline = {
  id: "line",
  name: "完成提交",
  date: p.date,
  startTime: "01:00",
  endTime: "01:00",
  stepsMode: true,
  domain: "work",
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  items: [{ id: "item", planId: p.id, durationMinutes: 120, step: p }],
};
test("独立步骤不创建计划；发布只创建一个最终目标，重复发布不重复", () => {
  const draft = changeTimeline(emptyData(), { timeline: t, expectedUpdatedAt: null });
  assert.equal(draft.plans.length, 0);
  assert.equal(minuteLabel(schedule(draft.timelines[0], [])[0].start, t.date), "前日 23:00");
  const published = changeTimeline(draft, {
    timeline: draft.timelines[0],
    expectedUpdatedAt: draft.timelines[0].updatedAt,
    publishGoal: true,
  });
  assert.equal(published.plans.length, 1);
  assert.equal(published.plans[0].text, t.name);
  assert.equal(published.plans[0].date, t.date);
  assert.equal(published.plans[0].domain, "work");
  const again = changeTimeline(published, {
    timeline: published.timelines[0],
    expectedUpdatedAt: published.timelines[0].updatedAt,
    publishGoal: true,
  });
  assert.equal(again.plans.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(coerceData(JSON.parse(JSON.stringify(again))))),
    JSON.parse(JSON.stringify(again)),
  );
  assert.deepEqual(mergeData(again, emptyData()).timelines, again.timelines);
});
test("发布旧关联时间线，原步骤保存在时间线且普通计划仅剩目标；原排程不变", () => {
  const legacy = {
    ...t,
    stepsMode: undefined,
    items: [{ id: "item", planId: p.id, durationMinutes: 120 }],
  };
  const original = { ...emptyData(), plans: [p], timelines: [legacy] };
  const published = changeTimeline(original, {
    timeline: legacy,
    expectedUpdatedAt: 1,
    publishGoal: true,
  });
  assert.equal(published.plans.filter((x) => x.deletedAt === null).length, 1);
  assert.equal(published.timelines[0].items[0].step?.text, p.text);
  assert.equal(
    schedule(legacy, [p])[0].start,
    schedule(published.timelines[0], published.plans)[0].start,
  );
});
test("修改已发布目标同步名称日期，保留完成状态；步骤完成独立，删除时间线保留目标", () => {
  const published = changeTimeline(emptyData(), {
    timeline: t,
    expectedUpdatedAt: null,
    publishGoal: true,
  });
  published.plans[0].done = true;
  published.plans[0].doneAt = 99;
  const changed = changeTimeline(published, {
    timeline: { ...published.timelines[0], name: "新目标", date: "2026-10-14" },
    expectedUpdatedAt: published.timelines[0].updatedAt,
  });
  assert.equal(changed.plans[0].text, "新目标");
  assert.equal(changed.plans[0].date, "2026-10-14");
  assert.equal(changed.plans[0].doneAt, 99);
  assert.equal(changed.timelines[0].items[0].step?.done, false);
  const deleted = changeTimeline(changed, {
    timeline: { ...changed.timelines[0], deletedAt: 1 },
    expectedUpdatedAt: changed.timelines[0].updatedAt,
  });
  assert.equal(deleted.plans[0].deletedAt, null);
});
test("拒绝空目标发布和缺失步骤；删除的旧计划不恢复为步骤", () => {
  assert.throws(() =>
    changeTimeline(emptyData(), {
      timeline: { ...t, items: [] },
      expectedUpdatedAt: null,
      publishGoal: true,
    }),
  );
  assert.throws(() => validateTimeline({ ...t, items: [{ ...t.items[0], step: undefined }] }));
  assert.equal(
    coerceData({ timelines: [{ ...t, items: [{ ...t.items[0], step: { ...p, text: "" } }] }] })
      .timelines.length,
    0,
  );
});
