import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { applyAiPlans, type AiPlanBatch } from "../src/lib/aiPlans";
import { emptyData } from "../src/lib/validate";
import { draftText, eventResponse, knowledgeResponse, type EventDraft } from "../src/lib/ai";

/** 生成稳定的两项草稿批次，供网页和桌面共享算法测试。 */
function batch(): AiPlanBatch {
  return {
    account: "alice",
    requestId: "6aa2e266-9cc8-4cd6-99e8-554b605193be",
    items: [
      { index: 0, date: "2026-11-19", text: "讨论项目", domain: "work" },
      { index: 1, date: "2026-11-20", text: "散步", domain: "life" },
    ],
  };
}
/** 构造明确跨午夜的预览数据。 */
function draft(): EventDraft {
  return {
    index: 0,
    date: "2026-11-19",
    title: "夜间值班",
    domain: "work",
    startTime: "23:30",
    endDate: "2026-11-20",
    endTime: "00:30",
    durationMinutes: 60,
    questions: [],
    unresolvedTimeText: null,
  };
}

test("AI 计划整批保存且重复确认不覆盖、不复活已删除项目", () => {
  const first = applyAiPlans(emptyData(), batch(), "alice", 100);
  assert.equal(first.plans.length, 2);
  first.plans[0] = { ...first.plans[0], text: "用户改过", deletedAt: 200 };
  const second = applyAiPlans(first, batch(), "alice", 300);
  assert.equal(second.plans.length, 2);
  assert.equal(second.plans[0].deletedAt, 200);
  assert.equal(second.plans[0].text, "用户改过");
});
test("AI 批量保存先全部校验，跨账号或单条非法不能部分写入", () => {
  const original = emptyData();
  assert.throws(() => applyAiPlans(original, batch(), "bob"), /账号/);
  const invalid = batch();
  invalid.items[1].date = "2026-02-30";
  assert.throws(() => applyAiPlans(original, invalid, "alice"), /日期/);
  assert.equal(original.plans.length, 0);
  invalid.items[1].date = "2026-11-20";
  invalid.items[1].index = 0;
  assert.throws(() => applyAiPlans(original, invalid, "alice"));
});
test("桌面生成代码与网页原子保存算法一致", () => {
  const desktop = createRequire(import.meta.url)("../electron/aiPlans.cjs");
  assert.deepEqual(
    desktop.applyAiPlans(emptyData(), batch(), "alice", 100),
    applyAiPlans(emptyData(), batch(), "alice", 100),
  );
  assert.throws(() => desktop.applyAiPlans(emptyData(), batch(), null));
});
test("时间作为文字保留，跨天正确，矛盾耗时和小数分钟不能保存", () => {
  assert.match(draftText(draft()), /2026-11-20 00:30/);
  assert.throws(() => draftText({ ...draft(), durationMinutes: 30 }), /不一致/);
  assert.throws(
    () => draftText({ ...draft(), endDate: null, endTime: null, durationMinutes: 1.5 }),
    /整数/,
  );
  assert.throws(() => draftText({ ...draft(), endDate: "2026-11-19" }), /晚于/);
});
test("响应结构校验拒绝对象型文案、非法时间和重复编号，避免渲染白屏", () => {
  const good = {
    requestId: batch().requestId,
    status: "READY",
    referenceDate: "2026-11-19",
    timezone: "Asia/Shanghai",
    drafts: [draft()],
    warnings: [],
  };
  assert.equal(eventResponse(good).drafts.length, 1);
  assert.throws(() => eventResponse({ ...good, warnings: [{}] }));
  assert.throws(() => eventResponse({ ...good, drafts: [{ ...draft(), startTime: {} }] }));
  assert.throws(() => eventResponse({ ...good, drafts: [draft(), draft()] }));
  assert.throws(() =>
    knowledgeResponse({
      requestId: batch().requestId,
      answer: "答案",
      coverage: "片段",
      sources: [],
      warnings: [{}],
    }),
  );
});
