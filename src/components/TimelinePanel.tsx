import { useEffect, useRef, useState } from "react";
import type { AppData, Plan, Timeline } from "../lib/types";
import {
  dayMinute,
  minuteLabel,
  onDay,
  schedule,
  startMinute,
  type TimelineChange,
} from "../lib/timelines";
import { newId } from "../lib/validate";
import "./timeline.css";

type Props = {
  data: AppData;
  date: string;
  /** 将时间线修改交给数据层保存。 */
  save: (change: TimelineChange) => Promise<void>;
  /** 切换目标计划的完成状态。 */
  toggle: (id: string) => void;
};
/** 展示所选日期的时间线入口，以及创建和编辑预排的对话框。 */
export default function TimelinePanel({ data, date, save, toggle }: Props) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(date);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const lines = data.timelines ?? [];
  useEffect(() => {
    setViewDate(date);
  }, [date]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  /** 携带预期版本保存时间线，并维护保存中状态与错误提示。 */
  async function commit(t: Timeline, current?: Timeline, newPlan?: Plan, publishGoal?: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await save({
        timeline: t,
        expectedUpdatedAt: current?.updatedAt ?? null,
        newPlan,
        publishGoal,
      });
      if (!current || current.date !== t.date) setViewDate(t.date);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  const visible = lines
    .filter((t) => onDay(t, data.plans, viewDate))
    .sort(
      (a, b) =>
        (schedule(a, data.plans)[0]?.start ?? startMinute(a)) -
        (schedule(b, data.plans)[0]?.start ?? startMinute(b)),
    );
  return (
    <>
      <button
        className="timeline-entry"
        onClick={() => {
          setViewDate(date);
          setError("");
          setOpen(true);
        }}
      >
        <span>◷ 时间预排</span>
        <small>
          {lines.filter((t) => onDay(t, data.plans, date)).length} 条时间线 · 安排这一天 →
        </small>
      </button>
      <dialog
        ref={dialog}
        className="timeline-dialog"
        aria-labelledby="timeline-title"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <header className="timeline-heading">
          <div>
            <small>MY LITTLE DAYS · 给时间一点安排</small>
            <h2 id="timeline-title">{viewDate} · 时间预排</h2>
          </div>
          <button onClick={() => setOpen(false)} aria-label="关闭时间预排">
            ×
          </button>
        </header>
        <p className="timeline-intro">
          先确定最终目标和完成时间，再填事项耗时，自动向前倒推。步骤只保存在时间线中，完成预排后仅将最终目标加入计划。
        </p>
        <p className="timeline-intro">保存到本机后，登录时或点击「立即同步」同步到其他设备。</p>
        {viewDate !== date && <button onClick={() => setViewDate(date)}>← 返回 {date}</button>}
        {error && (
          <p className="timeline-error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={busy} className="timeline-fieldset">
          <form
            key={viewDate}
            className="timeline-create"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              const now = Date.now();
              void commit({
                id: newId(),
                name: String(f.get("name")),
                date: String(f.get("date")),
                startTime: String(f.get("end")),
                endTime: String(f.get("end")),
                stepsMode: true,
                domain: f.get("domain") === "work" ? "work" : "life",
                items: [],
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
              });
            }}
          >
            <label>
              最终目标
              <input name="name" placeholder="例如：完成项目提交" required maxLength={100} />
            </label>
            <label>
              完成日期
              <input name="date" type="date" defaultValue={viewDate} required />
            </label>
            <label>
              目标完成时间
              <input name="end" type="time" defaultValue="18:00" required />
            </label>
            <label>
              目标分类
              <select name="domain">
                <option value="life">生活</option>
                <option value="work">工作</option>
              </select>
            </label>
            <button className="add-btn" type="submit">
              ＋ 新时间线
            </button>
          </form>
          {!visible.length && (
            <div className="timeline-empty">🌱 这一天还没有安排。先创建一条时间线吧。</div>
          )}
          {visible.map((t) => (
            <TimelineCard
              key={`${t.id}:${t.updatedAt}`}
              t={t}
              data={data}
              date={viewDate}
              toggle={toggle}
              editOrigin={() => setViewDate(t.date)}
              commit={(next, plan, publishGoal) => commit(next, t, plan, publishGoal)}
            />
          ))}
        </fieldset>
        <p className="timeline-intro" aria-live="polite">
          {busy ? "正在保存…" : "删除时间线会保留已加入的目标计划。"}
        </p>
      </dialog>
    </>
  );
}

/** 用横向时间轴展示一条预排，支持调整目标、耗时和执行顺序。 */
function TimelineCard({
  t,
  data,
  date,
  commit,
  toggle,
  editOrigin,
}: {
  t: Timeline;
  data: AppData;
  date: string;
  /** 保存当前时间线卡片的修改，必要时将最终目标发布为计划。 */
  commit: (t: Timeline, p?: Plan, publishGoal?: boolean) => Promise<void>;
  /** 切换指定时间线步骤的完成状态。 */
  toggle: (id: string) => void;
  /** 打开原日期的时间线，以便编辑跨天延续的排程。 */
  editOrigin: () => void;
}) {
  const rows = schedule(t, data.plans);
  const continued = t.date !== date;
  const origin = dayMinute(date);
  const shown = continued ? rows.filter((r) => r.start < origin + 1440 && r.end > origin) : rows;
  const otherLines = data.timelines.filter((l) => l.id !== t.id && l.deletedAt === null);
  const otherRows = otherLines.flatMap((l) => schedule(l, data.plans));
  const overlap = rows.some((a) => otherRows.some((b) => a.start < b.end && a.end > b.start));
  const duplicate = t.items.some((i) =>
    otherLines.some((l) => l.items.some((j) => j.planId === i.planId)),
  );
  const goal = data.plans.find((p) => p.id === t.goalPlanId && p.deletedAt === null);
  const total = rows.reduce((n, r) => n + r.durationMinutes, 0);
  /** 从时间线中移除指定步骤或计划引用。 */
  const remove = (id: string) => void commit({ ...t, items: t.items.filter((i) => i.id !== id) });
  /** 调整步骤顺序，保存后按新的顺序重新计算排程。 */
  function move(id: string, delta: number) {
    const items = [...t.items];
    const index = items.findIndex((i) => i.id === id);
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    void commit({ ...t, items });
  }
  return (
    <article className="timeline-card">
      {continued ? (
        <>
          <h3>{t.name}</h3>
          <p>
            目标完成于 {t.date} {t.endTime ?? t.startTime}{" "}
            <button onClick={editOrigin}>编辑原时间线 →</button>
          </p>
        </>
      ) : (
        <form
          className="timeline-settings"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void commit({
              ...t,
              name: String(f.get("name")),
              date: String(f.get("date")),
              startTime: String(f.get("end")),
              endTime: String(f.get("end")),
              domain: f.get("domain") === "work" ? "work" : "life",
            });
          }}
        >
          <label>
            最终目标
            <input name="name" defaultValue={t.name} required maxLength={100} />
          </label>
          <label>
            完成日期
            <input name="date" type="date" defaultValue={t.date} required />
          </label>
          <label>
            完成时间
            <input name="end" type="time" defaultValue={t.endTime ?? t.startTime} required />
          </label>
          <label>
            目标分类
            <select name="domain" defaultValue={t.domain ?? "life"}>
              <option value="life">生活</option>
              <option value="work">工作</option>
            </select>
          </label>
          <button type="submit">保存目标</button>
          <button type="button" onClick={() => void commit({ ...t, deletedAt: Date.now() })}>
            删除时间线
          </button>
        </form>
      )}
      <p className="timeline-summary">
        共 {total} 分钟 · 需要从 {minuteLabel(rows[0]?.start ?? startMinute(t), t.date)} 开始 · 目标{" "}
        {t.endTime ?? t.startTime} 完成
      </p>
      {overlap && (
        <p className="timeline-warning">部分安排与其他时间线重叠，可修改目标时间或耗时。</p>
      )}
      {duplicate && (
        <p className="timeline-warning" role="alert">
          同步后出现重复关联，请从其中一条时间线移出重复事项。
        </p>
      )}
      {goal && (
        <label className="timeline-goal-check">
          <input type="checkbox" checked={goal.done} onChange={() => toggle(goal.id)} />
          目标计划：{goal.text}
          {goal.done ? " · 已完成" : ""}
        </label>
      )}
      <div className="timeline-axis" role="region" aria-label="横向时间轴，可左右滚动" tabIndex={0}>
        <ol className="timeline-rows">
          {shown.map((row) => (
            <li key={row.id}>
              <div className="timeline-time">
                {minuteLabel(continued ? Math.max(origin, row.start) : row.start, date)}
                <span>
                  至 {minuteLabel(continued ? Math.min(origin + 1440, row.end) : row.end, date)}
                </span>
              </div>
              <div className="timeline-task">
                <label className={row.plan.done ? "timeline-done" : ""}>
                  <input
                    type="checkbox"
                    checked={row.plan.done}
                    onChange={() =>
                      row.step
                        ? void commit({
                            ...t,
                            items: t.items.map((i) =>
                              i.id === row.id
                                ? {
                                    ...i,
                                    step: {
                                      ...row.plan,
                                      done: !row.plan.done,
                                      doneAt: row.plan.done ? null : Date.now(),
                                      updatedAt: Date.now(),
                                    },
                                  }
                                : i,
                            ),
                          })
                        : toggle(row.plan.id)
                    }
                  />
                  {row.plan.text}
                </label>
                {continued ? (
                  <small>完整事项：{row.durationMinutes} 分钟</small>
                ) : (
                  <form
                    className="timeline-actions"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const durationMinutes = Number(new FormData(e.currentTarget).get("duration"));
                      void commit({
                        ...t,
                        items: t.items.map((i) =>
                          i.id === row.id ? { ...i, durationMinutes } : i,
                        ),
                      });
                    }}
                  >
                    <label>
                      <input
                        aria-label={`${row.plan.text}耗时（分钟）`}
                        name="duration"
                        type="number"
                        min="1"
                        step="1"
                        required
                        defaultValue={row.durationMinutes}
                      />{" "}
                      分钟
                    </label>
                    <button type="submit">保存</button>
                    <button
                      type="button"
                      aria-label={`前移${row.plan.text}`}
                      disabled={t.items[0]?.id === row.id}
                      onClick={() => move(row.id, -1)}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      aria-label={`后移${row.plan.text}`}
                      disabled={t.items.at(-1)?.id === row.id}
                      onClick={() => move(row.id, 1)}
                    >
                      →
                    </button>
                    <button type="button" onClick={() => remove(row.id)}>
                      移出
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="timeline-endpoint">
          ⚑ {minuteLabel(startMinute(t), date)}
          <strong>{t.name}</strong>
        </div>
      </div>
      {!rows.length && <p className="timeline-empty">加入第一件小事，时间线就开始了。</p>}
      {!continued && (
        <>
          {t.items
            .filter(
              (i) => !i.step && !data.plans.some((p) => p.id === i.planId && p.deletedAt === null),
            )
            .map((i) => (
              <p key={i.id} className="timeline-intro">
                原计划已删除，不计入排程。<button onClick={() => remove(i.id)}>移除引用</button>
              </p>
            ))}
          <form
            className="timeline-add"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const now = Date.now();
              const plan: Plan = {
                id: newId(),
                date: t.date,
                text: String(f.get("text")).trim(),
                domain: f.get("domain") === "work" ? "work" : "life",
                done: false,
                doneAt: null,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
              };
              void commit({
                ...t,
                items: [
                  ...t.items,
                  {
                    id: newId(),
                    planId: plan.id,
                    durationMinutes: Number(f.get("duration")),
                    step: plan,
                  },
                ],
              });
            }}
          >
            <label>
              新事项
              <input name="text" placeholder="例如：阅读、午饭、开会" required maxLength={500} />
            </label>
            <label>
              分钟
              <input name="duration" type="number" min="1" step="1" defaultValue="30" required />
            </label>
            <label>
              分类
              <select name="domain">
                <option value="life">生活</option>
                <option value="work">工作</option>
              </select>
            </label>
            <button type="submit" className="add-btn">
              ＋ 加入
            </button>
          </form>
          <div className="timeline-publish">
            <button
              type="button"
              className="add-btn"
              disabled={!rows.length}
              onClick={() => void commit(t, undefined, true)}
            >
              {goal ? "更新目标计划" : "完成预排，加入计划"}
            </button>
            <small>
              {t.stepsMode
                ? "日历中只显示最终目标，步骤留在这条时间线里。"
                : "保存后，原关联事项移入时间线，日历中只保留最终目标。"}
            </small>
          </div>
        </>
      )}
    </article>
  );
}
