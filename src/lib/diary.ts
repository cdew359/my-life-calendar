export interface DiaryEntry {
  date: string;
  title: string;
  content: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}
export interface DiaryInput {
  title: string;
  content: string;
  expectedRevision: number;
}
export interface DiarySearch {
  q: string;
  from?: string;
  to?: string;
  page: number;
}
/** 校验日记日期的格式及其是否为真实日历日期。 */
export function validDiaryDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const n = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value;
}
/** 校验日记正文、标题和预期版本，并限制输入长度。 */
export function validateDiary(input: unknown): DiaryInput {
  const x = input as DiaryInput;
  if (
    !x ||
    typeof x.title !== "string" ||
    typeof x.content !== "string" ||
    !x.content.trim() ||
    x.title.length > 100 ||
    x.content.length > 20000 ||
    !Number.isSafeInteger(x.expectedRevision) ||
    x.expectedRevision < 0
  )
    throw Error("标题最多100字，正文1～20000字，版本号必须有效");
  return { title: x.title.trim(), content: x.content, expectedRevision: x.expectedRevision };
}
/** 校验搜索关键词、日期范围和页码，生成受限的查询参数。 */
export function validateDiarySearch(input: DiarySearch): DiarySearch {
  const q = input.q.trim();
  if (
    !q ||
    q.length > 100 ||
    !Number.isInteger(input.page) ||
    input.page < 1 ||
    input.page > 100 ||
    (input.from && !validDiaryDate(input.from)) ||
    (input.to && !validDiaryDate(input.to)) ||
    (input.from && input.to && input.from > input.to)
  )
    throw Error("请输入1～100字关键词、有效日期范围及页码");
  return { ...input, q };
}
