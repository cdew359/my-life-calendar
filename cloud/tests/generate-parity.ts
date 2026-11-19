import fs from "node:fs";
import { coerceData, emptyData } from "../../src/lib/validate.ts";
import { mergeData, purgeDeleted } from "../../src/lib/sync.ts";
const now = 4102444800000; // Stable metadata; fixtures do not expire during later test runs.
/** 构造测试用计划数据。 */
const plan = (id: string, over = {}) => ({
  id,
  date: "2026-10-17",
  text: id,
  domain: "life",
  done: false,
  doneAt: null,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...over,
});
const fixtures: unknown[] = [];
/** 记录 TypeScript 数据处理的输入与期望结果，生成供 Java 对照的兼容用例。 */
function add(name: string, incoming: any, current: any = {}) {
  const a = coerceData(incoming),
    b = coerceData(current);
  a.timelines = a.timelines.map((t) => {
    const raw = incoming.timelines?.find((r: any) => r.id === t.id),
      stored = b.timelines.find((r) => r.id === t.id);
    if (
      stored &&
      (stored.stepsMode || stored.items.some((i) => i.step)) &&
      (!raw?.items?.some((i: any) => i.step) || (stored.stepsMode && raw.stepsMode !== true)) &&
      !(raw?.stepsMode === true && stored.stepsMode && raw.items?.length === 0)
    )
      return stored;
    return stored?.endTime !== undefined && raw?.endTime === undefined && t.deletedAt === null
      ? stored
      : t;
  });
  fixtures.push({ name, incoming, current, expected: purgeDeleted(mergeData(a, b)) });
}
add("empty", {}, {});
add("metadata", {
  plans: [plan("a", { shareWith: [" bob ", "bob"], sharedBy: " alice " })],
  notes: [{ ...plan("n"), text: " 笔记 " }],
  habits: [{ ...plan("h"), checkIns: ["2026-10-17", "bad", "2026-10-16"], archivedAt: null }],
  anniversaries: [{ ...plan("ann"), name: " 生日 ", kind: "once" }],
  reminders: [
    {
      ...plan("r"),
      time: "20:00",
      mode: "weekly",
      weekdays: [5, 1, 5, 9],
      periodDays: 2,
      anchorDate: "2026-10-17",
      enabled: true,
    },
  ],
  homeCity: { city: { name: " 上海 ", lat: 31, lon: 121 }, updatedAt: now },
});
for (let n = 0; n < 40; n++) {
  const incoming = {
    plans: [plan("a", { updatedAt: now + n, deletedAt: n % 3 === 0 ? now + n : null }), plan("b")],
    habits: [{ ...plan("h", { updatedAt: now + n }), checkIns: ["2026-10-16"], archivedAt: null }],
    watchCity: { city: { name: "杭州", lat: 30, lon: 120 }, updatedAt: now + n },
  };
  const current = {
    plans: [plan("a", { updatedAt: now + 20, deletedAt: n % 5 === 0 ? now + 20 : null })],
    habits: [{ ...plan("h", { updatedAt: now + 20 }), checkIns: ["2026-10-17"], archivedAt: null }],
    watchCity: { city: { name: "上海", lat: 31, lon: 121 }, updatedAt: now + 20 },
  };
  add("merge-" + n, incoming, current);
}
const line = {
  id: "line",
  name: " 目标 ",
  date: "2026-10-17",
  startTime: "23:50",
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  items: [{ id: "i", planId: "p", durationMinutes: 30 }],
};
add("forward-cross-day", { plans: [plan("p")], timelines: [line] });
const goal = {
  ...line,
  date: "2026-10-18",
  endTime: "00:20",
  stepsMode: true,
  goalPlanId: "timeline-goal:line",
  domain: "work",
  items: [{ ...line.items[0], step: plan("p") }],
};
add("embedded-step", { timelines: [goal] });
add(
  "protect-deadline",
  { plans: [plan("p")], timelines: [{ ...line, updatedAt: now + 10 }] },
  { plans: [plan("p")], timelines: [goal] },
);
add(
  "protect-steps",
  { timelines: [{ ...goal, stepsMode: false, items: line.items, updatedAt: now + 10 }] },
  { timelines: [goal] },
);
add(
  "empty-steps",
  { timelines: [{ ...goal, items: [], updatedAt: now + 10 }] },
  { timelines: [goal] },
);
add("invalid-import", {
  plans: [plan("invalid", { date: "2026-02-30" })],
  timelines: [{ ...goal, items: [{ ...goal.items[0], durationMinutes: 0 }] }],
});
fs.mkdirSync("cloud/calendar-service/src/test/resources", { recursive: true });
for (const calendar of ["solar", "lunar"]) {
  const birthday = { calendar, month: 2, day: 29, leapMonth: true };
  const ann = { ...plan("birthday"), name: "妈妈", kind: "yearly", birthday };
  add(`birthday-${calendar}`, { anniversaries: [ann] });
  add(
    `birthday-legacy-${calendar}`,
    { anniversaries: [{ ...ann, birthday: undefined, name: "母亲", updatedAt: now + 1 }] },
    { anniversaries: [ann] },
  );
  add(
    `birthday-deleted-${calendar}`,
    { anniversaries: [{ ...ann, birthday: undefined, deletedAt: now + 2 }] },
    { anniversaries: [ann] },
  );
}
for (const birthday of [
  { calendar: "solar", month: 2, day: 30 },
  { calendar: "lunar", month: 13, day: 1 },
  { calendar: "lunar", month: 1, day: 31 },
  { calendar: "lunar", month: 1.5, day: 1 },
  { calendar: "lunar", month: 1, day: 1, leapMonth: "true" },
]) {
  add("birthday-validation-" + JSON.stringify(birthday), {
    anniversaries: [{ ...plan("birthday-invalid"), name: "妈妈", kind: "yearly", birthday }],
  });
}
fs.writeFileSync(
  "cloud/calendar-service/src/test/resources/sync-parity.json",
  JSON.stringify(fixtures, null, 2) + "\n",
);
console.log("Generated " + fixtures.length + " TypeScript compatibility fixtures");
