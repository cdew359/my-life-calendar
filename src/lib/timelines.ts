import type { AppData, Plan, Timeline } from "./types";

// UTC is used only as a civil-calendar arithmetic grid, not as a timezone conversion.
/** 将日期映射为民用日历的分钟刻度；UTC 仅用于日期运算，不进行本地时区转换。 */
export function dayMinute(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期无效");
  const stamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date)
    throw new Error("日期无效");
  return stamp / 60000;
}
/** 返回时间线基准日期和时间对应的分钟刻度。 */
export function startMinute(t: Timeline): number {
  const time = t.endTime ?? t.startTime;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("目标时间无效");
  const [h, m] = time.split(":").map(Number);
  return dayMinute(t.date) + h * 60 + m;
}
/** 校验时间线目标、日期、步骤引用及至少一分钟的整数耗时。 */
export function validateTimeline(t: Timeline): void {
  if (
    !t ||
    typeof t.id !== "string" ||
    !t.id ||
    typeof t.name !== "string" ||
    !t.name.trim() ||
    t.name.length > 100 ||
    !Array.isArray(t.items)
  )
    throw new Error("时间线名称不能为空，最多 100 字");
  for (const n of [t.createdAt, t.updatedAt])
    if (!Number.isFinite(n)) throw new Error("时间线元数据无效");
  if (t.deletedAt !== null && !Number.isFinite(t.deletedAt)) throw new Error("时间线删除标记无效");
  if (
    t.goalPlanId !== undefined &&
    (typeof t.goalPlanId !== "string" || t.goalPlanId !== `timeline-goal:${t.id}`)
  )
    throw new Error("目标计划无效");
  let end = startMinute(t);
  const ids = new Set<string>(),
    plans = new Set<string>();
  for (const item of t.items) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id ||
      typeof item.planId !== "string" ||
      !item.planId ||
      ids.has(item.id) ||
      plans.has(item.planId)
    )
      throw new Error("事项重复或无效");
    if (!Number.isSafeInteger(item.durationMinutes) || item.durationMinutes < 1)
      throw new Error("耗时必须是至少 1 分钟的整数");
    if (
      item.step &&
      (item.step.id !== item.planId ||
        typeof item.step.text !== "string" ||
        !item.step.text.trim() ||
        item.step.text.length > 500 ||
        !["work", "life"].includes(item.step.domain) ||
        typeof item.step.done !== "boolean" ||
        item.step.deletedAt !== null ||
        !Number.isFinite(item.step.createdAt) ||
        !Number.isFinite(item.step.updatedAt) ||
        (item.step.doneAt !== null && !Number.isFinite(item.step.doneAt)))
    )
      throw new Error("时间线步骤无效");
    if (t.stepsMode && !item.step) throw new Error("时间线步骤缺失");
    ids.add(item.id);
    plans.add(item.planId);
    end += t.endTime === undefined ? item.durationMinutes : -item.durationMinutes;
    if (
      !Number.isSafeInteger(end) ||
      end < dayMinute("0001-01-01") ||
      end >= dayMinute("9999-12-31") + 1440
    )
      throw new Error("总耗时超出支持的日期范围");
  }
}
/** 清洗时间线列表，兼容旧版字段并忽略不可恢复的记录。 */
export function coerceTimelines(raw: unknown, plans?: Plan[]): Timeline[] {
  if (!Array.isArray(raw)) return [];
  const result = new Map<string, Timeline>();
  for (const t of raw) {
    try {
      validateTimeline(t);
      const normalized: Timeline = {
        id: t.id,
        name: t.name.trim(),
        date: t.date,
        startTime: t.startTime,
        ...(t.endTime === undefined ? {} : { endTime: t.endTime }),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        deletedAt: t.deletedAt,
        ...(t.stepsMode === true ? { stepsMode: true } : {}),
        ...(t.goalPlanId ? { goalPlanId: t.goalPlanId } : {}),
        ...(t.domain === "work" || t.domain === "life" ? { domain: t.domain } : {}),
        items: t.items.map((i: Timeline["items"][number]) => ({
          id: i.id,
          planId: i.planId,
          durationMinutes: i.durationMinutes,
          ...(i.step
            ? {
                step: {
                  id: i.planId,
                  date: t.date,
                  text: i.step.text.trim(),
                  domain: i.step.domain,
                  done: i.step.done,
                  doneAt: i.step.doneAt,
                  createdAt: i.step.createdAt,
                  updatedAt: i.step.updatedAt,
                  deletedAt: null,
                },
              }
            : {}),
        })),
      };
      if (normalized.endTime === undefined) {
        const duration = normalized.items
          .filter(
            (i) =>
              plans === undefined || plans.some((p) => p.id === i.planId && p.deletedAt === null),
          )
          .reduce((n, i) => n + i.durationMinutes, 0);
        const deadline = new Date((startMinute(normalized) + duration) * 60000).toISOString();
        normalized.date = deadline.slice(0, 10);
        normalized.endTime = deadline.slice(11, 16);
      }
      validateTimeline(normalized);
      result.set(t.id, normalized);
    } catch {
      /* Invalid imported timelines cannot affect the other entities. */
    }
  }
  return [...result.values()];
}
/** 根据最终目标时间倒推每个步骤的起止时刻，并兼容旧版顺排时间线。 */
export function schedule(t: Timeline, plans: Plan[]) {
  const alive = new Map(plans.filter((p) => p.deletedAt === null).map((p) => [p.id, p]));
  const duration = t.items
    .filter((i) => i.step || alive.has(i.planId))
    .reduce((n, i) => n + i.durationMinutes, 0);
  let cursor = startMinute(t) - (t.endTime === undefined ? 0 : duration);
  return t.items.flatMap((item) => {
    const plan = item.step ?? alive.get(item.planId);
    if (!plan) return [];
    const start = cursor;
    cursor += item.durationMinutes;
    return [{ ...item, plan, start, end: cursor }];
  });
}
/** 判断时间线是否在指定日期开始、结束或跨天延续。 */
export function onDay(t: Timeline, plans: Plan[], date: string): boolean {
  if (t.deletedAt !== null) return false;
  if (t.date === date) return true;
  const start = dayMinute(date);
  return schedule(t, plans).some((i) => i.start < start + 1440 && i.end > start);
}
/** 将分钟刻度转换为时间文本，跨天时附加日期说明。 */
export function minuteLabel(minute: number, origin: string): string {
  const iso = new Date(minute * 60000).toISOString();
  const offset = Math.floor((minute - dayMinute(origin)) / 1440);
  return `${offset === 0 ? "" : offset === 1 ? "次日 " : offset === -1 ? "前日 " : iso.slice(0, 10) + " "}${iso.slice(11, 16)}`;
}
export type TimelineChange = {
  timeline: Timeline;
  expectedUpdatedAt: number | null;
  newPlan?: Plan;
  publishGoal?: boolean;
};
/** 按预期版本更新一条时间线，校验步骤冲突，并在发布时只把最终目标写入计划。 */
export function changeTimeline(data: AppData, input: TimelineChange): AppData {
  const t = input.timeline;
  validateTimeline(t);
  const current = (data.timelines ?? []).find((x) => x.id === t.id);
  if ((current?.updatedAt ?? null) !== input.expectedUpdatedAt)
    throw new Error("时间线已更新，请关闭编辑后重试");
  let plans = data.plans;
  if (input.newPlan) {
    const p = input.newPlan;
    if (
      !p.id ||
      plans.some((x) => x.id === p.id) ||
      !p.text.trim() ||
      p.date !== t.date ||
      p.deletedAt !== null ||
      !t.items.some((i) => i.planId === p.id)
    )
      throw new Error("新增计划无效");
    plans = [...plans, p];
  }
  for (const item of t.items) {
    if (item.step) continue;
    // Existing dangling references are retained for sync; newly linked references must be alive.
    if (
      !current?.items.some((i) => i.planId === item.planId) &&
      !plans.some((p) => p.id === item.planId && p.deletedAt === null)
    )
      throw new Error("所选计划已删除");
    if (
      !current?.items.some((i) => i.planId === item.planId) &&
      t.deletedAt === null &&
      (data.timelines ?? []).some(
        (other) =>
          other.id !== t.id &&
          other.deletedAt === null &&
          other.items.some((i) => i.planId === item.planId),
      )
    )
      throw new Error("计划已被其他时间线引用，请先移出重复事项");
  }
  const now = Math.max(Date.now(), (current?.updatedAt ?? 0) + 1);
  const next = {
    ...t,
    name: t.name.trim(),
    updatedAt: now,
    deletedAt: t.deletedAt === null ? null : now,
  };
  if (input.publishGoal) {
    if (t.deletedAt !== null || !schedule(t, plans).length) throw new Error("请先添加预排步骤");
    const linked = new Set(t.items.filter((i) => !i.step).map((i) => i.planId));
    if (
      data.timelines.some(
        (other) =>
          other.id !== t.id &&
          other.deletedAt === null &&
          other.items.some((i) => !i.step && linked.has(i.planId)),
      )
    )
      throw new Error("请先移出其他时间线中的重复关联");
    next.items = schedule(t, plans).map((row) => ({
      id: row.id,
      planId: row.planId,
      durationMinutes: row.durationMinutes,
      step: { ...row.plan, shareWith: undefined, sharedBy: undefined },
    }));
    next.stepsMode = true;
    next.goalPlanId = `timeline-goal:${t.id}`;
    plans = plans.map((p) =>
      linked.has(p.id)
        ? {
            ...p,
            updatedAt: Math.max(now, p.updatedAt + 1),
            deletedAt: Math.max(now, p.updatedAt + 1),
          }
        : p,
    );
  }
  if (
    next.goalPlanId &&
    next.deletedAt === null &&
    (input.publishGoal || plans.some((p) => p.id === next.goalPlanId && p.deletedAt === null))
  ) {
    const goal = plans.find((p) => p.id === next.goalPlanId);
    const goalTime = Math.max(now, (goal?.updatedAt ?? 0) + 1);
    const updated: Plan = {
      ...(goal ?? { id: next.goalPlanId, createdAt: now, done: false, doneAt: null }),
      text: next.name,
      date: next.date,
      domain: next.domain ?? "life",
      updatedAt: goalTime,
      deletedAt: null,
    };
    plans = [...plans.filter((p) => p.id !== updated.id), updated];
  }
  return {
    ...data,
    plans,
    timelines: [...(data.timelines ?? []).filter((x) => x.id !== t.id), next],
  };
}
