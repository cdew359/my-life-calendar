import { useMemo } from "react";
import { buildMonthGrid, parseKey } from "../lib/dates";
import { lunarLabel } from "../lib/lunar";
import { anniversaryOnDate } from "../lib/anniversaries";
import type { Anniversary, DayNote, Plan, Reminder } from "../lib/types";
import { reminderAppliesOn } from "../lib/reminders";
import { holidayInfoOf } from "../lib/holidays";
import { foldCellContent } from "../lib/cellContent";

type Props = {
  /** 统计某一天有排程或跨天延续的时间线数量。 */
  timelineCount?: (date: string) => number;
  year: number;
  month: number;
  plansByDate: Map<string, Plan[]>;
  notesByDate: Map<string, DayNote[]>;
  anniversaries: Anniversary[];
  reminders: Reminder[];
  today: string;
  selected: string;
  /** 通知父组件选中指定日期。 */
  onSelect: (key: string) => void;
};

/** 渲染包含计划摘要、节假日和时间线数量的月历网格。 */
export default function MonthGrid({
  timelineCount,
  year,
  month,
  plansByDate,
  notesByDate,
  anniversaries,
  reminders,
  today,
  selected,
  onSelect,
}: Props) {
  const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const labels = useMemo(() => {
    const map = new Map<string, ReturnType<typeof lunarLabel>>();
    for (const cell of cells) {
      map.set(cell.key, lunarLabel(parseKey(cell.key)));
    }
    return map;
  }, [cells]);

  return (
    <div className="grid">
      {cells.map((cell) => {
        const plans = plansByDate.get(cell.key) ?? [];
        const notes = notesByDate.get(cell.key) ?? [];
        const undone = plans.filter((p) => !p.done).length;
        const lunar = labels.get(cell.key)!;
        const annName = anniversaryOnDate(anniversaries, cell.key);
        const holiday = holidayInfoOf(cell.key);
        const { visible, folded } = foldCellContent(plans, notes);
        const classes = [
          "day",
          cell.inMonth ? "" : "out",
          cell.key === today ? "is-today" : "",
          cell.key === selected ? "is-selected" : "",
          holiday?.kind === "holiday" ? "is-holiday" : "",
          holiday?.kind === "adjusted" ? "is-adjusted" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button key={cell.key} className={classes} onClick={() => onSelect(cell.key)}>
            {holiday && (
              <span className={holiday.kind === "holiday" ? "day-tag hol" : "day-tag adj"}>
                {holiday.kind === "holiday" ? "休" : "班"}
              </span>
            )}
            <span className="day-head">
              <span className="day-num">{cell.day}</span>
              {/* 类名加 lk- 前缀：lunar.kind 的 "day" 若直接当类名会与 .day 格子样式撞名，
                  导致标签继承整格的高度/圆角/悬停遮罩，出现"格中格" */}
              <span className={annName ? "day-lunar lk-ann" : `day-lunar lk-${lunar.kind}`}>
                {annName ?? lunar.text}
              </span>
            </span>
            {!!timelineCount?.(cell.key) && (
              <span className="timeline-count">◷ {timelineCount(cell.key)}</span>
            )}
            <span className="chips">
              {visible.map((chip) =>
                chip.kind === "note" ? (
                  <span key={chip.note.id} className="chip note">
                    ✎ {chip.note.text}
                  </span>
                ) : (
                  <span
                    key={chip.plan.id}
                    className={
                      chip.plan.done
                        ? "chip done"
                        : chip.plan.domain === "work"
                          ? "chip work"
                          : "chip"
                    }
                  >
                    {chip.plan.done ? "✓ " : ""}
                    {chip.plan.text}
                  </span>
                ),
              )}
              {folded > 0 && <span className="chip more">+{folded}</span>}
            </span>
            {(() => {
              // 红点 = 有未完成计划；绿点 = 无未完成计划且当天有记录
              // 注：不放 title 属性——原生悬停提示会以深色矩形弹出，破坏整格悬停的观感
              if (undone > 0) {
                return <span className="undone-dot" />;
              }
              if (notes.length > 0) {
                return <span className="undone-dot alldone" />;
              }
              return null;
            })()}
            {reminders.some((r) => r.enabled && reminderAppliesOn(r, cell.key)) && (
              <span className="reminder-cell" aria-hidden="true">
                ⏰
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
