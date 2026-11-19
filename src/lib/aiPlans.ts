import type { AppData, Domain, Plan } from "./types";

export interface AiPlanBatch {
  account: string;
  requestId: string;
  items: { index: number; date: string; text: string; domain: Domain }[];
}
/** 校验真实日期，逻辑独立，供 Electron 主进程使用同一份代码。 */
function validDate(value: string): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01")
    return false;
  const timestamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
/** 先整批校验，再构造快照；同一草稿重复确认不会覆盖、复活或重复新增计划。 */
export function applyAiPlans(
  data: AppData,
  input: AiPlanBatch,
  activeAccount: string | null,
  now = Date.now(),
): AppData {
  if (
    !input ||
    !activeAccount ||
    input.account !== activeAccount ||
    typeof input.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.requestId) ||
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > 5
  )
    throw new Error("账号已变化或 AI 草稿无效，请重新打开录入");
  const indices = new Set<number>();
  for (const item of input.items) {
    if (
      !item ||
      !Number.isInteger(item.index) ||
      item.index < 0 ||
      item.index > 4 ||
      indices.has(item.index) ||
      !validDate(item.date) ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      item.text.length > 1000 ||
      (item.domain !== "work" && item.domain !== "life")
    )
      throw new Error("请检查所选计划的日期、内容和分类");
    indices.add(item.index);
  }
  const existing = new Set(data.plans.map((p) => p.id));
  const added: Plan[] = input.items.flatMap((item) => {
    const id = `ai:${input.requestId}:${item.index}`;
    return existing.has(id)
      ? []
      : [
          {
            id,
            date: item.date,
            text: item.text.trim(),
            domain: item.domain,
            done: false,
            doneAt: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        ];
  });
  return { ...data, plans: [...data.plans, ...added] };
}
