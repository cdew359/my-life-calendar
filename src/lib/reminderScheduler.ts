import { browserStorage as localStorage } from "./browserStorage";
import { useEffect } from "react";
import { reminderAppliesOn, timeMinutes } from "./reminders";
import { dateKey } from "./dates";
import type { Reminder } from "./types";

const FIRED_KEY = "calendar.reminder.fired";

/**
 * 网页版页内提醒触发器（页面开着才有效；桌面端由主进程触发，传入 enabled=false 停用）。
 * 每 30 秒检查：当天适用 + 已过触发时刻 + 今天未触发过 → 页内 toast + 浏览器通知（已授权时）。
 */
export function useReminderScheduler(
  reminders: Reminder[],
  enabled: boolean,
  onToast: (text: string) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    /** 检查当前时刻匹配的提醒，并按触发记录避免重复通知。 */
    const check = () => {
      const now = new Date();
      const today = dateKey(now);
      let fired: Record<string, string> = {};
      try {
        fired = JSON.parse(localStorage.getItem(FIRED_KEY) ?? "{}");
      } catch {
        // 解析失败按无记录处理
      }
      let changed = false;
      for (const r of reminders) {
        if (r.deletedAt !== null || !r.enabled || fired[r.id] === today) continue;
        if (!reminderAppliesOn(r, today)) continue;
        if (now.getHours() * 60 + now.getMinutes() < timeMinutes(r.time)) continue;
        fired[r.id] = today;
        changed = true;
        onToast(r.text);
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("日历表提醒", { body: r.text });
          } catch {
            // 通知构造失败仅影响弹窗，不影响页内 toast
          }
        }
      }
      if (changed) {
        try {
          localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
        } catch {
          // 存储失败只影响当天去重
        }
      }
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [reminders, enabled, onToast]);
}

/** 按当前平台申请通知权限，并返回是否允许提醒。 */
export async function requestReminderPermission() {
  if (
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission === "default"
  ) {
    try {
      await Notification.requestPermission();
    } catch {
      // 拒绝授权不影响页内 toast
    }
  }
}
