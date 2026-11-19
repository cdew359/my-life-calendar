import assert from "node:assert/strict";
import { test } from "node:test";
import { dataEquals, mergeData, purgeDeleted } from "../src/lib/sync.ts";
import { emptyData } from "../src/lib/validate.ts";
import type { AppData, Habit, Plan } from "../src/lib/types.ts";

/** 构造测试用计划数据。 */
function plan(id: string, over: Partial<Plan> = {}): Plan {
  return {
    id,
    date: "2026-09-20",
    text: `计划${id}`,
    done: false,
    doneAt: null,
    createdAt: 1,
    domain: "life",
    updatedAt: 1,
    deletedAt: null,
    ...over,
  };
}

/** 构造测试用习惯及打卡数据。 */
function habit(id: string, over: Partial<Habit> = {}): Habit {
  return {
    id,
    text: `习惯${id}`,
    domain: "life",
    createdAt: 1,
    archivedAt: null,
    checkIns: [],
    updatedAt: 1,
    deletedAt: null,
    ...over,
  };
}

/** 在空日历上覆盖指定字段，构造同步合并测试的完整快照。 */
function data(over: Partial<AppData> = {}): AppData {
  return { ...emptyData(), ...over };
}

test("远端新条目并入合并结果", () => {
  const local = data({ plans: [plan("a")] });
  const remote = data({ plans: [plan("a"), plan("b", { updatedAt: 5 })] });
  const merged = mergeData(local, remote);
  assert.equal(merged.plans.length, 2);
});

test("同 id 最后写入赢", () => {
  const local = data({ plans: [plan("a", { text: "本地新版", updatedAt: 10 })] });
  const remote = data({ plans: [plan("a", { text: "远端旧版", updatedAt: 5 })] });
  assert.equal(mergeData(local, remote).plans[0].text, "本地新版");
  assert.equal(mergeData(remote, local).plans[0].text, "本地新版");

  const older = data({ plans: [plan("a", { text: "本地旧版", updatedAt: 3 })] });
  assert.equal(mergeData(older, remote).plans[0].text, "远端旧版");
});

test("较新的墓碑压过较旧的编辑（删除生效）", () => {
  const local = data({ plans: [plan("a", { deletedAt: 100, updatedAt: 100 })] });
  const remote = data({ plans: [plan("a", { updatedAt: 50 })] });
  assert.equal(mergeData(local, remote).plans[0].deletedAt, 100);
});

test("删除后的新编辑复活条目（编辑更新则胜出）", () => {
  const local = data({ plans: [plan("a", { deletedAt: 50, updatedAt: 50 })] });
  const remote = data({ plans: [plan("a", { text: "删了又改", updatedAt: 80 })] });
  const merged = mergeData(local, remote);
  assert.equal(merged.plans[0].deletedAt, null);
  assert.equal(merged.plans[0].text, "删了又改");
});

test("时间戳相同取墓碑方，删除结论稳定", () => {
  const local = data({ plans: [plan("a", { deletedAt: 60, updatedAt: 60 })] });
  const remote = data({ plans: [plan("a", { updatedAt: 60 })] });
  assert.equal(mergeData(local, remote).plans[0].deletedAt, 60);
  assert.equal(mergeData(remote, local).plans[0].deletedAt, 60);
});

test("习惯打卡按并集合并，文本最后写入赢", () => {
  const local = data({
    habits: [habit("h", { text: "读书", checkIns: ["2026-09-15"], updatedAt: 10 })],
  });
  const remote = data({
    habits: [habit("h", { text: "读书 30 分钟", checkIns: ["2026-09-16"], updatedAt: 20 })],
  });
  const merged = mergeData(local, remote);
  assert.equal(merged.habits[0].text, "读书 30 分钟");
  assert.deepEqual(merged.habits[0].checkIns, ["2026-09-15", "2026-09-16"]);
});

test("purge：清掉 30 天前的墓碑，保留新墓碑与活条目", () => {
  const now = 1_000_000_000_000;
  const d = data({
    plans: [
      plan("old-dead", { deletedAt: now - 31 * 86_400_000 }),
      plan("fresh-dead", { deletedAt: now - 86_400_000 }),
      plan("alive"),
    ],
  });
  const purged = purgeDeleted(d, now);
  assert.deepEqual(
    purged.plans.map((p) => p.id),
    ["fresh-dead", "alive"],
  );
});

test("dataEquals 检出内容差异", () => {
  const a = data({ plans: [plan("a")] });
  const b = data({ plans: [plan("a", { done: true, updatedAt: 9 })] });
  const c = data({ plans: [plan("a")] });
  assert.equal(dataEquals(a, c), true);
  assert.equal(dataEquals(a, b), false);
});

test("homeCity 合并：updatedAt 新者胜，一方为空取另一方", () => {
  const HOME = { name: "衢州", lat: 28.94, lon: 118.87 };
  const SH = { name: "上海", lat: 31.23, lon: 121.47 };
  const local = emptyData();
  local.homeCity = { city: HOME, updatedAt: 100 };
  const remote = emptyData();
  remote.homeCity = { city: SH, updatedAt: 200 };
  assert.deepEqual(mergeData(local, remote).homeCity?.city, SH);
  assert.deepEqual(mergeData(local, emptyData()).homeCity?.city, HOME);
  assert.equal(mergeData(emptyData(), emptyData()).homeCity, null);
});

test("watchCity 同样按 updatedAt 合并", () => {
  const SH = { name: "上海", lat: 31.23, lon: 121.47 };
  const HZ = { name: "杭州", lat: 30.27, lon: 120.15 };
  const local = emptyData();
  local.watchCity = { city: SH, updatedAt: 50 };
  const remote = emptyData();
  remote.watchCity = { city: HZ, updatedAt: 60 };
  assert.deepEqual(mergeData(local, remote).watchCity?.city, HZ);
  assert.deepEqual(mergeData(local, emptyData()).watchCity?.city, SH);
  assert.equal(mergeData(emptyData(), emptyData()).watchCity, null);
});
