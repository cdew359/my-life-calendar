import { coerceData, emptyData } from "../../src/lib/validate.ts";
import { dataEquals } from "../../src/lib/sync.ts";
import { mergeUpload } from "../src/shared-merge.ts";
import { mergeSharedInto } from "../src/app.ts";
import type { Account } from "../src/accounts.ts";
import type { StoredState } from "../src/store.ts";
import type { Plan, DayNote } from "../../src/lib/types.ts";

export type MigrationDiary = {
  account_id: string;
  diary_date: string;
  title: string;
  content: string;
  revision: number;
  created_at: number;
  updated_at: number;
  deleted: boolean | number;
};
export interface BothData {
  formal_accounts: Account[];
  cloud_accounts: Account[];
  formal_states: Record<string, StoredState>;
  cloud_states: Record<string, StoredState>;
  formal_diaries: MigrationDiary[];
  cloud_diaries: MigrationDiary[];
  baseline_accounts: Account[];
  baseline_diaries: MigrationDiary[];
}
/** 比较两份日记的标题、正文和删除状态是否一致，不将版本号差异视为内容冲突。 */
const same = (a: MigrationDiary | undefined, b: MigrationDiary | undefined) =>
  a && b
    ? a.title === b.title && a.content === b.content && Boolean(a.deleted) === Boolean(b.deleted)
    : !a && !b;
/** 基于共同快照合并两边账号、日历和日记；身份或正文存在双边冲突时中止而不覆盖数据。 */
export function reconcile(input: BothData) {
  const accounts = new Map<string, Account>(),
    names = new Map<string, string>(),
    baseline = new Map(input.baseline_accounts.map((a) => [a.id, a]));
  for (const a of input.formal_accounts) {
    accounts.set(a.id, { ...a });
    names.set(a.username.toLowerCase(), a.id);
  }
  for (const cloud of input.cloud_accounts) {
    const formal = accounts.get(cloud.id),
      base = baseline.get(cloud.id),
      name = names.get(cloud.username.toLowerCase());
    if (name && name !== cloud.id) throw Error("账号身份冲突；原始两份数据已保留，需人工处理");
    if (formal) {
      if (formal.username !== cloud.username || formal.hash !== cloud.hash)
        throw Error("账号凭据或身份冲突；合并已中止");
      if ((cloud.nickname ?? null) !== (base?.nickname ?? null)) {
        if (
          (formal.nickname ?? null) !== (base?.nickname ?? null) &&
          (formal.nickname ?? null) !== (cloud.nickname ?? null)
        )
          throw Error("昵称存在双边修改冲突；合并已中止");
        if (cloud.nickname) formal.nickname = cloud.nickname;
        else delete formal.nickname;
      }
    } else {
      accounts.set(cloud.id, { ...cloud });
      names.set(cloud.username.toLowerCase(), cloud.id);
    }
  }
  const states: Record<string, StoredState> = {};
  let calendarDifferences = 0;
  for (const a of accounts.values()) {
    const f = input.formal_states[a.id],
      c = input.cloud_states[a.id];
    const current = coerceData(f?.data ?? emptyData());
    if (!dataEquals(current, coerceData(c?.data ?? emptyData()))) calendarDifferences++;
    states[a.id] = {
      version: Math.max(Date.now(), f?.version ?? 0, c?.version ?? 0) + 1,
      data: mergeUpload(c?.data ?? emptyData(), current),
    };
  }
  for (const owner of accounts.values())
    for (const other of accounts.values()) {
      if (owner.id === other.id) continue;
      const mine = states[owner.id].data,
        theirs = states[other.id].data;
      const plans = mergeSharedInto<Plan>(owner.username, other.username, mine.plans, theirs.plans),
        notes = mergeSharedInto<DayNote>(owner.username, other.username, mine.notes, theirs.notes);
      states[other.id].data = { ...theirs, plans: plans.list, notes: notes.list };
    }
  /** 用账号和日期生成日记的复合标识，避免跨账号错误合并。 */
  const key = (d: MigrationDiary) => JSON.stringify([d.account_id, d.diary_date]);
  const formal = new Map(input.formal_diaries.map((d) => [key(d), d])),
    cloud = new Map(input.cloud_diaries.map((d) => [key(d), d])),
    base = new Map(input.baseline_diaries.map((d) => [key(d), d]));
  const diaries: MigrationDiary[] = [];
  for (const id of new Set([...formal.keys(), ...cloud.keys()])) {
    const f = formal.get(id),
      c = cloud.get(id),
      b = base.get(id);
    let winner: MigrationDiary;
    if (!f) winner = c!;
    else if (!c) winner = f;
    else if (same(f, c)) winner = f.updated_at >= c.updated_at ? f : c;
    else if (same(c, b)) winner = f;
    else if (same(f, b)) winner = c;
    else throw Error("同一天日记在两边存在内容冲突；未覆盖任何正文，请先处理备份中的冲突");
    if (!accounts.has(winner.account_id)) throw Error("日记归属账号缺失；合并已中止");
    const different = f && c && !same(f, c);
    diaries.push({
      ...winner,
      deleted: Boolean(winner.deleted),
      revision: Math.max(f?.revision ?? 0, c?.revision ?? 0) + (different ? 1 : 0),
      created_at: Math.min(f?.created_at ?? Infinity, c?.created_at ?? Infinity),
      updated_at: different ? Math.max(Date.now(), winner.updated_at) : winner.updated_at,
    });
  }
  return {
    accounts: [...accounts.values()],
    states,
    diaries,
    summary: {
      accounts: accounts.size,
      calendars: Object.keys(states).length,
      calendarDifferences,
      diaries: diaries.length,
    },
  };
}
if (process.argv.includes("--stdin")) {
  let raw = "";
  for await (const part of process.stdin) raw += part;
  process.stdout.write(JSON.stringify(reconcile(JSON.parse(raw))));
}
