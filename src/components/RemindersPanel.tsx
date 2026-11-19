import { useState } from "react";
import { motion } from "motion/react";
import { describeRule, nextFireDate } from "../lib/reminders";
import type { Reminder } from "../lib/types";

type Props = {
  reminders: Reminder[];
  today: string;
  /** 将新增条目交给父组件保存。 */
  onAdd: (input: Omit<Reminder, "id" | "createdAt" | "updatedAt" | "deletedAt">) => void;
  /** 通知父组件切换指定条目的状态。 */
  onToggle: (id: string, enabled: boolean) => void;
  /** 通知父组件移除指定条目。 */
  onRemove: (id: string) => void;
  /** 通知父组件关闭当前面板。 */
  onClose: () => void;
};

type Preset = "daily" | "workday" | "weekend" | "custom" | "periodic";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAY_CN = ["", "一", "二", "三", "四", "五", "六", "日"];

/** 展示提醒列表，并提供新增、启停和删除操作。 */
export default function RemindersPanel({
  reminders,
  today,
  onAdd,
  onToggle,
  onRemove,
  onClose,
}: Props) {
  const [text, setText] = useState("");
  const [time, setTime] = useState("09:00");
  const [preset, setPreset] = useState<Preset>("daily");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [periodDays, setPeriodDays] = useState(3);
  const [anchorDate, setAnchorDate] = useState(today);

  const weekdaysForPreset: Record<Preset, number[]> = {
    daily: [1, 2, 3, 4, 5, 6, 7],
    workday: [1, 2, 3, 4, 5],
    weekend: [6, 7],
    custom: weekdays,
    periodic: [],
  };

  /** 校验提醒时间与重复规则后提交新增提醒。 */
  const submit = () => {
    if (!text.trim() || !time) return;
    onAdd({
      text,
      time,
      mode: preset === "periodic" ? "periodic" : "weekly",
      weekdays: preset === "periodic" ? [] : weekdaysForPreset[preset],
      periodDays,
      anchorDate,
      enabled: true,
    });
    setText("");
  };

  const alive = reminders.filter((r) => r.deletedAt === null);

  return (
    <div
      className="sync-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="sync-dialog reminders-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="定时提醒"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
      >
        <div className="sync-dialog-head">
          <h3>定时提醒</h3>
          <button className="remove" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {alive.length === 0 && (
          <p className="sync-hint">还没有提醒。桌面端常驻托盘后台触发，网页版需页面开着。</p>
        )}

        <ul className="reminder-list">
          {alive.map((r) => {
            const next = r.enabled ? nextFireDate(r, today) : null;
            return (
              <li key={r.id} className="reminder-row">
                <span className="reminder-time">{r.time}</span>
                <span className={r.enabled ? "reminder-text" : "reminder-text off"}>{r.text}</span>
                <span className="reminder-rule">{describeRule(r)}</span>
                {next && (
                  <span className="reminder-next">{next === today ? "今天" : next.slice(5)}</span>
                )}
                <button
                  className={r.enabled ? "reminder-switch on" : "reminder-switch"}
                  onClick={() => onToggle(r.id, !r.enabled)}
                  aria-pressed={r.enabled}
                  aria-label={r.enabled ? "暂停提醒" : "启用提醒"}
                />
                <button className="remove" onClick={() => onRemove(r.id)} aria-label="删除提醒">
                  ×
                </button>
              </li>
            );
          })}
        </ul>

        <div className="reminder-form">
          <div className="quick-add">
            <input
              className="reminder-time-input"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="提醒什么？"
              maxLength={40}
            />
          </div>
          <div className="domain-toggle reminder-presets">
            {(["daily", "workday", "weekend", "custom", "periodic"] as Preset[]).map((p) => (
              <button
                key={p}
                className={preset === p ? "seg active life" : "seg life"}
                onClick={() => setPreset(p)}
              >
                {p === "daily"
                  ? "每天"
                  : p === "workday"
                    ? "工作日"
                    : p === "weekend"
                      ? "周末"
                      : p === "custom"
                        ? "自选"
                        : "周期"}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="weekday-picker">
              {WEEKDAYS.map((d) => (
                <button
                  key={d}
                  className={weekdays.includes(d) ? "wd on" : "wd"}
                  onClick={() =>
                    setWeekdays((cur) =>
                      cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d],
                    )
                  }
                >
                  {WEEKDAY_CN[d]}
                </button>
              ))}
            </div>
          )}
          {preset === "periodic" && (
            <div className="period-row">
              <span className="sync-hint">每</span>
              <input
                className="ann-input"
                type="number"
                min={1}
                max={365}
                value={periodDays}
                onChange={(e) =>
                  setPeriodDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))
                }
              />
              <span className="sync-hint">天，自</span>
              <input
                className="ann-input date"
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
              />
              <span className="sync-hint">起</span>
            </div>
          )}
          <button className="add-btn" onClick={submit} disabled={!text.trim() || !time}>
            添加提醒
          </button>
        </div>
      </motion.div>
    </div>
  );
}
