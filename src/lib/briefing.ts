import { browserStorage as localStorage } from "./browserStorage";
import { useEffect, useRef } from "react";
import { dateKey } from "./dates";
import { getWeatherFor, wmoInfo, type WeatherInfo } from "./weather";
import type { CityRecord, Plan } from "./types";

/** 简报触发时刻（小时，本地时间） */
export const BRIEFING_HOUR = 21;

const FIRED_KEY = "calendar.briefing.fired";

/** 简报文案：明天的计划 + 今明天气（常驻地区） */
export function briefingText(tomorrowPlans: string[], weather: WeatherInfo | null): string {
  const planPart =
    tomorrowPlans.length > 0 ? tomorrowPlans.join("、") : "还没有安排，考虑规划一下？";
  let weatherPart = "";
  if (weather) {
    const t = wmoInfo(weather.today.code);
    const m = wmoInfo(weather.tomorrow.code);
    weatherPart = `｜今天 ${t.text} ${weather.today.min}~${weather.today.max}°，明天 ${m.text} ${weather.tomorrow.min}~${weather.tomorrow.max}°`;
  }
  return `明天：${planPart}${weatherPart}`;
}

export type BriefingSnapshot = { plans: Plan[]; home: CityRecord | null };
export type BriefingSync = "fresh" | "local" | "failed";

/** 汇总目标日期的未完成计划和习惯，生成晚间提醒正文。 */
export async function collectBriefing(
  now: Date,
  prepare: () => Promise<BriefingSync>,
  snapshot: () => BriefingSnapshot,
  weatherFor: (home: CityRecord) => Promise<WeatherInfo | null> = getWeatherFor,
): Promise<string> {
  let status: BriefingSync;
  try {
    status = await prepare();
  } catch {
    status = "failed";
  }
  // Read only after synchronization, including its asynchronous disk write.
  const { plans, home } = snapshot();
  const tomorrow = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const items = plans
    .filter((p) => p.deletedAt === null && !p.done && p.date === tomorrow)
    .map((p) => p.text);
  let weather: WeatherInfo | null = null;
  if (home) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      weather = await Promise.race([
        weatherFor(home),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 8000);
        }),
      ]);
    } catch {
      /* Weather failure must not suppress the plan reminder. */
    } finally {
      clearTimeout(timer);
    }
  }
  return (
    briefingText(items, weather) + (status === "failed" ? "（云端更新失败，使用本地计划）" : "")
  );
}

/** Shared web/desktop scheduler. Desktop main process also ticks while the window is hidden. */
export function useDailyBriefing(
  enabled: boolean,
  account: string | null,
  snapshot: () => BriefingSnapshot,
  prepare: () => Promise<BriefingSync>,
  onToast: (text: string) => void,
) {
  const latest = useRef({ snapshot, prepare, onToast });
  latest.current = { snapshot, prepare, onToast };
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false,
      busy = false;
    const firedKey = FIRED_KEY + ":" + (account === null ? "local" : "account:" + account);
    const desktop = window.desktopAPI?.briefing;
    /** 在提醒时间到达后先同步云端数据，再按账号和日期去重显示明日简报。 */
    const check = async () => {
      if (cancelled || busy || (!desktop && document.visibilityState === "hidden")) return;
      const now = new Date();
      if (now.getHours() < BRIEFING_HOUR) return;
      const today = dateKey(now);
      try {
        if (JSON.parse(localStorage.getItem(firedKey) ?? "{}").day === today) return;
      } catch {
        /* Retry corrupt state. */
      }
      busy = true;
      try {
        const text = await collectBriefing(now, latest.current.prepare, () =>
          latest.current.snapshot(),
        );
        if (cancelled || dateKey(new Date()) !== today) return;
        if (desktop) {
          if (!(await desktop.show(text, account))) return;
        } else {
          latest.current.onToast(text);
          if ("Notification" in window && Notification.permission === "granted") {
            try {
              new Notification("明日简报", { body: text });
            } catch {
              /* Toast delivered. */
            }
          }
        }
        try {
          localStorage.setItem(firedKey, JSON.stringify({ day: today }));
        } catch {
          /* Only deduplication is affected. */
        }
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    const unsubscribe = desktop?.onCheck(() => void check());
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe?.();
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [enabled, account]);
}
