import assert from "node:assert/strict";
import { test } from "node:test";
import { collectBriefing } from "../src/lib/briefing";
import type { Plan } from "../src/lib/types";
/** 构造测试用计划数据。 */
const plan = (id: string, text: string): Plan => ({
  id,
  text,
  date: "2026-10-16",
  domain: "life",
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  done: false,
  doneAt: null,
});
test("晚间简报等待云端拉取和落盘后才读取计划，排除云端已完成及已删除的事项", async () => {
  let plans = [plan("old", "旧的本地计划")];
  const result = await collectBriefing(
    new Date("2026-10-15T21:00:00"),
    async () => {
      await Promise.resolve();
      plans = [
        plan("new", "另一设备新增的目标"),
        { ...plan("done", "已完成"), done: true },
        { ...plan("gone", "已删除"), deletedAt: 2 },
      ];
      return "fresh";
    },
    () => ({ plans, home: null }),
  );
  assert.equal(result, "明天：另一设备新增的目标");
});
test("拉取失败继续使用本地计划，并明确标记数据未更新；天气失败不影响提醒", async () => {
  const result = await collectBriefing(
    new Date("2026-10-15T21:00:00"),
    async () => {
      throw Error("offline");
    },
    () => ({ plans: [plan("p", "散步")], home: { name: "上海", lat: 31, lon: 121 } }),
    async () => {
      throw Error("weather offline");
    },
  );
  assert.equal(result, "明天：散步（云端更新失败，使用本地计划）");
});
test("离线本机模式不误报同步失败；没有明日计划时继续给出规划提示", async () => {
  const result = await collectBriefing(
    new Date("2026-10-15T21:00:00"),
    async () => "local",
    () => ({ plans: [], home: null }),
  );
  assert.equal(result, "明天：还没有安排，考虑规划一下？");
});
