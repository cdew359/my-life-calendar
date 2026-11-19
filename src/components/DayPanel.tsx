import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { parseKey, WEEKDAY_FULL } from "../lib/dates";
import { lunarFull } from "../lib/lunar";
import { habitStreak } from "../lib/habits";
import type { DayNote, Domain, Habit, Plan } from "../lib/types";
import PlanItem from "./PlanItem";
import SharePicker from "./SharePicker";

type Mutations = {
  /** 新增指定日期的计划。 */
  addPlan: (date: string, text: string, domain: Domain) => void;
  /** 切换计划的完成状态。 */
  togglePlan: (id: string) => void;
  /** 删除指定计划，保留同步所需的删除标记。 */
  removePlan: (id: string) => void;
  /** 新增指定日期的每日记录。 */
  addNote: (date: string, text: string, domain: Domain) => void;
  /** 删除每日记录，保留同步所需的删除标记。 */
  removeNote: (id: string) => void;
  /** 新增需要持续打卡的习惯。 */
  addHabit: (text: string, domain: Domain) => void;
  /** 切换指定习惯在某一天的打卡状态。 */
  toggleHabitCheckIn: (id: string, date: string) => void;
  /** 移除指定习惯。 */
  removeHabit: (id: string) => void;
  /** 更新计划的分享对象列表。 */
  setPlanShare: (id: string, usernames: string[]) => void;
  /** 更新每日记录的分享对象列表。 */
  setNoteShare: (id: string, usernames: string[]) => void;
};

type Props = {
  dateKey: string;
  today: string;
  plans: Plan[];
  notes: DayNote[];
  habits: Habit[];
  /** 登录服务器后才能绑定分享 */
  canShare: boolean;
  selfUser: string | null;
  /** 账号名 → 昵称显示 */
  displayName: (username: string) => string;
  mutations: Mutations;
};

/** 显示工作与生活分类切换按钮。 */
function DomainToggle({
  value,
  onChange,
}: {
  value: Domain;
  /** 将用户修改后的值交给父组件。 */
  onChange: (d: Domain) => void;
}) {
  return (
    <div className="domain-toggle" role="group" aria-label="分类">
      <button
        className={value === "life" ? "seg active life" : "seg life"}
        onClick={() => onChange("life")}
        aria-pressed={value === "life"}
      >
        生活
      </button>
      <button
        className={value === "work" ? "seg active work" : "seg work"}
        onClick={() => onChange("work")}
        aria-pressed={value === "work"}
      >
        工作
      </button>
    </div>
  );
}

/** 展示所选日期的计划、每日记录及习惯打卡入口。 */
export default function DayPanel({
  dateKey,
  today,
  plans,
  notes,
  habits,
  canShare,
  selfUser,
  displayName,
  mutations,
}: Props) {
  const [planDraft, setPlanDraft] = useState("");
  const [planDomain, setPlanDomain] = useState<Domain>("life");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteDomain, setNoteDomain] = useState<Domain>("life");
  const [habitDraft, setHabitDraft] = useState("");
  const [habitDomain, setHabitDomain] = useState<Domain>("life");
  const [addingHabit, setAddingHabit] = useState(false);
  const [notePicking, setNotePicking] = useState<string | null>(null);
  const planInputRef = useRef<HTMLInputElement>(null);

  const d = parseKey(dateKey);
  const weekday = WEEKDAY_FULL[(d.getDay() + 6) % 7];
  const lunarText = useMemo(() => lunarFull(parseKey(dateKey)), [dateKey]);
  const done = plans.filter((p) => p.done).length;
  const activeHabits = habits.filter((h) => h.archivedAt === null);
  const isFuture = dateKey > today;

  // 切换日期后光标直接落在计划输入框，连续录入不用再点一次
  useEffect(() => {
    planInputRef.current?.focus();
  }, [dateKey]);

  /** 提交非空计划，并清空计划输入框。 */
  const submitPlan = () => {
    if (!planDraft.trim()) return;
    mutations.addPlan(dateKey, planDraft, planDomain);
    setPlanDraft("");
  };

  /** 提交非空每日记录，并清空记录输入框。 */
  const submitNote = () => {
    if (!noteDraft.trim()) return;
    mutations.addNote(dateKey, noteDraft, noteDomain);
    setNoteDraft("");
  };

  /** 提交非空习惯，并清空习惯输入框。 */
  const submitHabit = () => {
    if (!habitDraft.trim()) return;
    mutations.addHabit(habitDraft, habitDomain);
    setHabitDraft("");
    setAddingHabit(false);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          {d.getMonth() + 1}月{d.getDate()}日
        </h2>
        <span className="weekday-tag">{weekday}</span>
        {plans.length > 0 && (
          <span className="panel-count">
            {done}/{plans.length}
          </span>
        )}
      </div>
      <p className="panel-lunar">{lunarText}</p>

      {activeHabits.length > 0 && (
        <section className="day-section">
          <h3 className="section-title">今日打卡</h3>
          <ul className="habit-list">
            {activeHabits.map((h) => {
              const checked = h.checkIns.includes(dateKey);
              const streak = habitStreak(h, dateKey);
              return (
                <li key={h.id} className="habit-row">
                  <button
                    className="check"
                    onClick={() => mutations.toggleHabitCheckIn(h.id, dateKey)}
                    disabled={isFuture}
                    aria-pressed={checked}
                    aria-label={checked ? `取消打卡：${h.text}` : `打卡：${h.text}`}
                    title={isFuture ? "未来日期不能打卡" : undefined}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <motion.path
                        d="M6 12.5l4 4L18 8"
                        stroke="currentColor"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={false}
                        animate={{ pathLength: checked ? 1 : 0 }}
                        transition={{ type: "spring", stiffness: 380, damping: 28 }}
                      />
                    </svg>
                  </button>
                  <span className={h.domain === "work" ? "habit-text work" : "habit-text"}>
                    {h.text}
                  </span>
                  {streak > 0 && (
                    <span className="streak-badge" title={`截至这一天连续 ${streak} 天`}>
                      连续 {streak} 天
                    </span>
                  )}
                  <button
                    className="remove"
                    onClick={() => mutations.removeHabit(h.id)}
                    aria-label="删除习惯"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!addingHabit && (
        <button className="link-btn" onClick={() => setAddingHabit(true)}>
          + 新习惯
        </button>
      )}
      {addingHabit && (
        <div className="habit-form">
          <DomainToggle value={habitDomain} onChange={setHabitDomain} />
          <div className="quick-add">
            <input
              autoFocus
              value={habitDraft}
              onChange={(e) => setHabitDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitHabit();
                if (e.key === "Escape") setAddingHabit(false);
              }}
              placeholder="每天要做什么？如：读书 30 分钟"
              maxLength={40}
            />
            <button className="add-btn" onClick={submitHabit} disabled={!habitDraft.trim()}>
              添加
            </button>
          </div>
        </div>
      )}

      <section className="day-section">
        <h3 className="section-title">计划</h3>
        <div className="plan-add">
          <DomainToggle value={planDomain} onChange={setPlanDomain} />
          <div className="quick-add">
            <input
              ref={planInputRef}
              value={planDraft}
              onChange={(e) => setPlanDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitPlan();
              }}
              placeholder="想在这一天做什么？回车添加"
              maxLength={60}
            />
            <button className="add-btn" onClick={submitPlan} disabled={!planDraft.trim()}>
              添加
            </button>
          </div>
        </div>
        <ul className="plan-list">
          <AnimatePresence initial={false}>
            {plans.map((p) => (
              <PlanItem
                key={p.id}
                plan={p}
                canShare={canShare}
                selfUser={selfUser}
                displayName={displayName}
                onShare={(usernames) => mutations.setPlanShare(p.id, usernames)}
                onToggle={() => mutations.togglePlan(p.id)}
                onRemove={() => mutations.removePlan(p.id)}
              />
            ))}
          </AnimatePresence>
        </ul>
        {plans.length === 0 && <p className="empty-sm">这一天还没有计划</p>}
      </section>

      <section className="day-section">
        <h3 className="section-title">记录</h3>
        <div className="plan-add">
          <DomainToggle value={noteDomain} onChange={setNoteDomain} />
          <div className="quick-add">
            <input
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNote();
              }}
              placeholder="今天发生了什么？"
              maxLength={100}
            />
            <button className="add-btn" onClick={submitNote} disabled={!noteDraft.trim()}>
              记下
            </button>
          </div>
        </div>
        <ul className="note-list">
          <AnimatePresence initial={false}>
            {notes.map((n) => (
              <motion.li
                key={n.id}
                className={n.domain === "work" ? "note-item work" : "note-item"}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              >
                <span className={n.domain === "work" ? "note-tag work" : "note-tag"}>记</span>
                <span className="note-text">{n.text}</span>
                {n.sharedBy && <span className="shared-tag">↻ {displayName(n.sharedBy)}</span>}
                {!n.sharedBy &&
                  (n.shareWith ?? []).length > 0 &&
                  (n.shareWith ?? []).map((u) => (
                    <span key={u} className="share-chip">
                      ↗{displayName(u)}
                    </span>
                  ))}
                {canShare && !n.sharedBy && (
                  <button
                    className={n.shareWith?.length ? "share-btn has" : "share-btn"}
                    onClick={() => setNotePicking((cur) => (cur === n.id ? null : n.id))}
                    aria-label="绑定账号，同步给对方"
                    title="绑定账号，同步给对方"
                  >
                    👥
                  </button>
                )}
                {notePicking === n.id && (
                  <SharePicker
                    current={n.shareWith ?? []}
                    self={selfUser}
                    onChange={(usernames) => mutations.setNoteShare(n.id, usernames)}
                    onClose={() => setNotePicking(null)}
                  />
                )}
                <button
                  className="remove"
                  onClick={() => mutations.removeNote(n.id)}
                  aria-label="删除记录"
                >
                  ×
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {notes.length === 0 && <p className="empty-sm">记下当天发生的事，不用提前计划</p>}
      </section>
    </div>
  );
}
