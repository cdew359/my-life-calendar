import { getSyncConfig } from "./syncEngine";
import { isValidDateKey } from "./validate";
import type { Domain } from "./types";

export type AiConfig = NonNullable<ReturnType<typeof getSyncConfig>>;
export interface EventDraft {
  index: number;
  date: string;
  title: string;
  domain: Domain;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  unresolvedTimeText: string | null;
  questions: string[];
}
export interface EventResponse {
  requestId: string;
  status: string;
  referenceDate: string;
  timezone: string;
  drafts: EventDraft[];
  warnings: string[];
}
export interface Evidence {
  id: string;
  date: string;
  title: string;
  excerpt: string;
  revision: number;
}
export interface KnowledgeResponse {
  requestId: string;
  answer: string;
  sources: Evidence[];
  coverage: string;
  warnings: string[];
}
export interface AiCapabilities {
  enabled: boolean;
  events: boolean;
  knowledge: boolean;
}

/** 检查可空时间字段，防止无效结构进入表单或保存内容。 */
function nullableTime(value: unknown): boolean {
  return value == null || (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
}
/** 检查字符串列表，避免把模型返回对象直接传入 React。 */
function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** 同时比较地址、账号和令牌，禁止迟到的响应应用到另一登录会话。 */
export function sameAiSession(config: AiConfig): boolean {
  const current = getSyncConfig();
  return (
    !!current &&
    current.server === config.server &&
    current.username === config.username &&
    current.token === config.token
  );
}
/** 调用既有登录入口的 AI API，不提供独立模型地址或前端 API Key。 */
export async function aiCall(
  config: AiConfig,
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(config.server + "/api/ai/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer " + config.token, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
  });
  const data = await response.json().catch(() => ({}));
  if (!sameAiSession(config)) throw new Error("登录账号已变化，请重新打开 AI 助手");
  if (!response.ok)
    throw new Error(typeof data.error === "string" ? data.error : "AI 暂不可用，可继续手动操作");
  return data;
}
/** 解析草稿响应，避免错误响应结构导致页面白屏。 */
export function eventResponse(value: unknown): EventResponse {
  const data = value as EventResponse;
  if (
    !data ||
    typeof data.requestId !== "string" ||
    !isValidDateKey(data.referenceDate) ||
    !["READY", "NEEDS_CLARIFICATION", "NO_EVENT"].includes(data.status) ||
    data.timezone !== "Asia/Shanghai" ||
    !Array.isArray(data.drafts) ||
    data.drafts.length > 5 ||
    !stringList(data.warnings) ||
    data.drafts.some(
      (d) =>
        !d ||
        !Number.isInteger(d.index) ||
        !isValidDateKey(d.date) ||
        typeof d.title !== "string" ||
        d.index < 0 ||
        d.index > 4 ||
        !nullableTime(d.startTime) ||
        !nullableTime(d.endTime) ||
        (d.endDate != null && !isValidDateKey(d.endDate)) ||
        (d.unresolvedTimeText != null && typeof d.unresolvedTimeText !== "string") ||
        (d.durationMinutes != null &&
          (!Number.isInteger(d.durationMinutes) ||
            d.durationMinutes < 1 ||
            d.durationMinutes > 10080)) ||
        (d.domain !== "work" && d.domain !== "life") ||
        !stringList(d.questions),
    ) ||
    new Set(data.drafts.map((d) => d.index)).size !== data.drafts.length
  )
    throw new Error("AI 响应格式无效，原文仍保留");
  return data;
}
/** 验证答案与来源的基本结构，来源只通过日期打开本应用的日记页面。 */
export function knowledgeResponse(value: unknown): KnowledgeResponse {
  const data = value as KnowledgeResponse;
  if (
    !data ||
    typeof data.requestId !== "string" ||
    typeof data.answer !== "string" ||
    typeof data.coverage !== "string" ||
    !stringList(data.warnings) ||
    !Array.isArray(data.sources) ||
    data.sources.length > 5 ||
    data.sources.some(
      (s) =>
        !s ||
        !isValidDateKey(s.date) ||
        typeof s.title !== "string" ||
        typeof s.excerpt !== "string" ||
        typeof s.id !== "string" ||
        !Number.isInteger(s.revision),
    )
  )
    throw new Error("AI 答案格式无效，请调整问题");
  return data;
}
/** 将经确认的时间信息保留为文字，不声称已经建立时段或定时提醒。 */
export function draftText(draft: EventDraft): string {
  if ((draft.endTime && !draft.startTime) || (draft.endDate && !draft.endTime))
    throw new Error("请补全起止时间，或清空结束日期与结束时间");
  if (!nullableTime(draft.endTime) || (draft.endDate != null && !isValidDateKey(draft.endDate)))
    throw new Error("结束日期或时间无效");
  if (draft.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime))
    throw new Error("开始时间无效");
  if (draft.endTime && draft.startTime) {
    const duration =
      (Date.parse(`${draft.endDate || draft.date}T${draft.endTime}:00+08:00`) -
        Date.parse(`${draft.date}T${draft.startTime}:00+08:00`)) /
      60000;
    if (!Number.isFinite(duration) || duration < 1 || duration > 10080)
      throw new Error("结束时间须晚于开始时间，且间隔不超过7天");
    if (draft.durationMinutes != null && duration !== draft.durationMinutes)
      throw new Error("耗时与起止时间不一致，请修改或清空其中一项");
  }
  if (
    draft.durationMinutes != null &&
    (!Number.isInteger(draft.durationMinutes) ||
      draft.durationMinutes < 1 ||
      draft.durationMinutes > 10080)
  )
    throw new Error("耗时需为1～10080整数分钟");
  const start = draft.startTime || draft.unresolvedTimeText || "";
  const end = draft.endTime
    ? `（至${draft.endDate && draft.endDate !== draft.date ? draft.endDate + " " : ""}${draft.endTime}）`
    : "";
  const duration = draft.durationMinutes == null ? "" : `（预计${draft.durationMinutes}分钟）`;
  return `${start ? start + " " : ""}${draft.title.trim()}${end}${duration}`;
}
