import { useEffect, useRef } from "react";
import { browserStorage } from "./browserStorage";
import { dateKey } from "./dates";
import { dueBirthdays, deliverBirthdayNotices } from "./birthdays";
import type { Anniversary } from "./types";

/** 检查生日提醒的两个有效时段；上午过后不补发当天上午通知。 */
export function birthdayReminderWindow(now: Date): boolean {
  return (now.getHours() >= 9 && now.getHours() < 12) || now.getHours() >= 20;
}

/** 在网页和客户端中检查生日；提醒时段主动同步，按账号、生日和阶段持久化去重。 */
export function useBirthdayReminders(
  enabled: boolean,
  account: string | null,
  snapshot: () => Anniversary[],
  prepare: () => Promise<unknown>,
  onToast: (text: string) => void,
) {
  const latest = useRef({ snapshot, prepare, onToast });
  latest.current = { snapshot, prepare, onToast };
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false,
      busy = false,
      lastRefresh = 0;
    const desktop = window.desktopAPI?.briefing;
    const storageKey =
      "calendar.birthday.fired:" + (account === null ? "local" : "account:" + account);
    /** 同步结束后再取快照，切换账号或跨出提醒时段时取消发送。 */
    const check = async () => {
      if (cancelled || busy || (!desktop && document.visibilityState === "hidden")) return;
      if (!birthdayReminderWindow(new Date())) return;
      busy = true;
      try {
        if (Date.now() - lastRefresh >= 300_000) {
          lastRefresh = Date.now();
          try {
            await latest.current.prepare();
          } catch {
            /* 离线时仍使用本地生日。 */
          }
        }
        const now = new Date();
        if (cancelled || !birthdayReminderWindow(now)) return;
        const today = dateKey(now);
        let fired: Record<string, string> = {};
        try {
          const value: unknown = JSON.parse(browserStorage.getItem(storageKey) ?? "{}");
          if (value && typeof value === "object" && !Array.isArray(value)) {
            const cutoff = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 40));
            fired = Object.fromEntries(
              Object.entries(value).filter(
                ([, day]) => typeof day === "string" && day >= cutoff && day <= today,
              ),
            );
          }
        } catch {
          /* 损坏的去重记录不阻止提醒。 */
        }
        await deliverBirthdayNotices(
          dueBirthdays(latest.current.snapshot(), now),
          fired,
          today,
          async (notice) => {
            if (desktop?.showBirthday)
              return desktop.showBirthday(notice.body, account, notice.key);
            latest.current.onToast(notice.body);
            if ("Notification" in window && Notification.permission === "granted") {
              try {
                new Notification("家人生日提醒 🎂", { body: notice.body });
              } catch {
                /* 页内提示已送达。 */
              }
            }
            return true;
          },
          () => browserStorage.setItem(storageKey, JSON.stringify(fired)),
          () => !cancelled,
        );
      } catch {
        /* 通知失败后由下一次检查重试，不产生未处理的 Promise 拒绝。 */
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    const unsubscribe = desktop?.onCheck(() => void check());
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe?.();
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [enabled, account]);
}
