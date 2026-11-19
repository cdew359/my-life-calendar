import assert from "node:assert/strict";
import { test } from "node:test";
import {
  birthdayInYear,
  nextBirthday,
  dueBirthdays,
  deliverBirthdayNotices,
} from "../src/lib/birthdays";
import { birthdayReminderWindow } from "../src/lib/birthdayScheduler";
import { anniversaryOnDate, nextOccurrence } from "../src/lib/anniversaries";
import { coerceBirthday } from "../src/lib/birthdayRules";
import { coerceData } from "../src/lib/validate";
import { mergeData } from "../src/lib/sync";
import { SyncEngine } from "../src/lib/syncEngine";
import type { Anniversary, Birthday } from "../src/lib/types";

const solar: Birthday = { calendar: "solar", month: 10, day: 20, leapMonth: false };
const lunar: Birthday = { calendar: "lunar", month: 1, day: 1, leapMonth: false };
/** 构造有同步元数据的家人生日。 */
function family(birthday: Birthday = solar): Anniversary {
  return {
    id: "mom",
    name: "妈妈",
    kind: "yearly",
    date: "2000-01-01",
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    birthday,
  };
}

test("公历生日每年重复，2 月 29 日在平年落到 2 月 28 日", () => {
  assert.equal(nextBirthday(solar, "2026-10-20"), "2026-10-20");
  assert.equal(nextBirthday(solar, "2026-10-21"), "2027-10-20");
  assert.equal(birthdayInYear({ ...solar, month: 2, day: 29 }, 2027), "2027-02-28");
  assert.equal(birthdayInYear({ ...solar, month: 2, day: 29 }, 2028), "2028-02-29");
});

test("农历按对应农历年换算，跨公历年不漏掉腊月生日", () => {
  assert.equal(birthdayInYear(lunar, 2026), "2026-02-17");
  assert.equal(nextBirthday(lunar, "2026-02-18"), "2027-02-06");
  assert.equal(nextBirthday({ ...lunar, month: 12, day: 29 }, "2026-01-01"), "2026-02-16");
});

test("农历三十遇小月按廿九，闰月在缺少时回退普通月份", () => {
  assert.equal(birthdayInYear({ ...lunar, month: 12, day: 30 }, 2025), "2026-02-16");
  const leap = { ...lunar, month: 2, day: 1, leapMonth: true };
  assert.equal(birthdayInYear(leap, 2023), "2023-03-22");
  assert.equal(birthdayInYear(leap, 2024), "2024-03-10");
  // 普通二月生日不会在闰二月再过一次。
  assert.notEqual(nextBirthday({ ...leap, leapMonth: false }, "2023-03-22"), "2023-03-22");
});

test("两次提醒分别在前晚 20:00 和当天 09:00 生效，不补发过期上午提醒", () => {
  const entries = [family()];
  assert.equal(dueBirthdays(entries, new Date(2026, 9, 19, 19, 59)).length, 0);
  const eve = dueBirthdays(entries, new Date(2026, 9, 19, 20));
  assert.equal(eve.length, 1);
  assert.match(eve[0].body, /明天是妈妈的生日/);
  assert.equal(dueBirthdays(entries, new Date(2026, 9, 20, 8, 59)).length, 0);
  const morning = dueBirthdays(entries, new Date(2026, 9, 20, 9));
  assert.equal(morning.length, 1);
  assert.notEqual(eve[0].key, morning[0].key);
  assert.equal(dueBirthdays(entries, new Date(2026, 9, 20, 11, 59)).length, 1);
  assert.equal(dueBirthdays(entries, new Date(2026, 9, 20, 12)).length, 0);
  assert.equal(dueBirthdays(entries, new Date(2026, 9, 20, 20)).length, 0);
  assert.equal(birthdayReminderWindow(new Date(2026, 9, 19, 20)), true);
  assert.equal(birthdayReminderWindow(new Date(2026, 9, 20, 12)), false);
});

test("前一天跨年和农历生日提醒，删除墓碑不再触发", () => {
  assert.equal(
    dueBirthdays([family({ ...solar, month: 1, day: 1 })], new Date(2026, 11, 31, 20)).length,
    1,
  );
  assert.equal(dueBirthdays([family(lunar)], new Date(2026, 1, 16, 20)).length, 1);
  assert.equal(dueBirthdays([{ ...family(), deletedAt: 2 }], new Date(2026, 9, 19, 20)).length, 0);
});

test("生日显示在正确的月历格子及倒计时，不使用兼容占位日期", () => {
  const birthday = family(lunar);
  assert.equal(anniversaryOnDate([birthday], "2026-02-17"), "妈妈生日");
  assert.equal(anniversaryOnDate([birthday], "2026-01-01"), null);
  assert.equal(nextOccurrence(birthday, "2026-01-01"), "2026-02-17");
});

test("月日校验拒绝非法规则，清洗、导出和重新加载保留生日", () => {
  for (const value of [
    { ...solar, month: 13 },
    { ...solar, day: 0 },
    { ...solar, day: 1.1 },
    { ...solar, month: 4, day: 31 },
    { ...lunar, day: 31 },
    { ...solar, calendar: "unknown" },
  ]) {
    assert.equal(coerceBirthday(value), undefined);
  }
  assert.deepEqual(coerceBirthday({ ...solar, leapMonth: true }), solar);
  const data = coerceData({ anniversaries: [family(lunar)] });
  assert.deepEqual(coerceData(JSON.parse(JSON.stringify(data))).anniversaries[0].birthday, lunar);
});

test("旧客户端缺少生日字段时仍保留规则，同时允许更新名称和删除", () => {
  const current = coerceData({ anniversaries: [family(lunar)] });
  const legacy = { ...family(), name: "母亲", birthday: undefined, updatedAt: 2 };
  const result = mergeData(coerceData({ anniversaries: [legacy] }), current);
  assert.equal(result.anniversaries[0].name, "母亲");
  assert.deepEqual(result.anniversaries[0].birthday, lunar);
  const removed = mergeData(coerceData({ anniversaries: [{ ...legacy, deletedAt: 3 }] }), current);
  assert.equal(removed.anniversaries[0].deletedAt, 3);
  assert.deepEqual(removed.anniversaries[0].birthday, lunar);
});

test("同阶段提醒持久化去重，通知失败可重试，另一个账号独立提醒", async () => {
  const now = new Date(2026, 9, 19, 20),
    notices = dueBirthdays([family()], now);
  let saved = "{}",
    sends = 0;
  /** 模拟系统通知成功或暂时失败。 */
  const send = async () => {
    sends++;
    return sends > 1;
  };
  let fired: Record<string, string> = {};
  /** 模拟将当前账号触发记录写入磁盘。 */
  const persist = () => {
    saved = JSON.stringify(fired);
  };
  await deliverBirthdayNotices(notices, fired, "2026-10-19", send, persist, () => true);
  assert.deepEqual(fired, {});
  await deliverBirthdayNotices(notices, fired, "2026-10-19", send, persist, () => true);
  assert.equal(sends, 2);
  fired = JSON.parse(saved); // 模拟重启后从磁盘恢复。
  await deliverBirthdayNotices(notices, fired, "2026-10-19", send, persist, () => true);
  assert.equal(sends, 2);
  await deliverBirthdayNotices(
    notices,
    {},
    "2026-10-19",
    send,
    () => {},
    () => true,
  );
  assert.equal(sends, 3);
});

test("提醒发送期间切换账号，取消后续提醒并停止写旧账号状态", async () => {
  const notices = dueBirthdays(
    [family(), { ...family(), id: "dad", name: "爸爸" }],
    new Date(2026, 9, 19, 20),
  );
  let active = true,
    sends = 0,
    saves = 0;
  const fired = {};
  await deliverBirthdayNotices(
    notices,
    fired,
    "2026-10-19",
    async () => {
      sends++;
      active = false;
      return true;
    },
    () => {
      saves++;
    },
    () => active,
  );
  assert.equal(sends, 1);
  assert.equal(saves, 0);
  assert.deepEqual(fired, {});
});

test("旧服务端未声明生日能力时禁止上传，保留本机规则并提示升级", async (t) => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      /** 读取测试账号本地配置。 */
      getItem: (key: string) => values.get(key) ?? null,
      /** 写入测试账号本地配置。 */
      setItem: (key: string, value: string) => values.set(key, value),
      /** 清理测试账号本地配置。 */
      removeItem: (key: string) => values.delete(key),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown) => {
    urls.push(String(url));
    return Response.json({ ok: true, capabilities: [] });
  });
  const data = coerceData({ anniversaries: [family(lunar)] });
  let message = "";
  const engine = new SyncEngine({
    /** 取得包含农历生日的本地快照。 */
    getLocal: () => data,
    /** 拒绝旧服务端修改本机生日。 */
    apply: () => assert.fail("旧服务端不应清洗本机生日"),
    /** 记录更新服务端提示。 */
    onStatus: (status) => {
      if (status.state === "error") message = status.message ?? "";
    },
  });
  engine.enable("https://calendar.test", "test-token");
  assert.equal(await engine.syncOnce(), false);
  assert.deepEqual(urls, ["https://calendar.test/api/health"]);
  assert.match(message, /家人生日.*更新服务端/);
  assert.deepEqual(data.anniversaries[0].birthday, lunar);
});
