import { useState } from "react";
import { birthdayLabel, nextBirthday } from "../lib/birthdays";
import { coerceBirthday } from "../lib/birthdayRules";
import type { Anniversary, Birthday } from "../lib/types";

type Props = {
  anniversaries: Anniversary[];
  today: string;
  /** 保存家人姓名及生日规则。 */
  onAdd: (name: string, birthday: Birthday) => void;
  /** 删除生日并保留多端同步墓碑。 */
  onRemove: (id: string) => void;
  /** 关闭生日管理弹窗。 */
  onClose: () => void;
};

/** 展示家人生日和下次公历日期，提供农历、公历以及闰月生日录入。 */
export default function BirthdaysPanel({ anniversaries, today, onAdd, onRemove, onClose }: Props) {
  const [name, setName] = useState("");
  const [calendar, setCalendar] = useState<Birthday["calendar"]>("solar");
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [leapMonth, setLeapMonth] = useState(false);
  const birthday = coerceBirthday({ calendar, month, day, leapMonth });
  const alive = anniversaries
    .filter((a) => a.deletedAt === null && a.birthday)
    .sort((a, b) =>
      nextBirthday(a.birthday!, today).localeCompare(nextBirthday(b.birthday!, today)),
    );
  /** 校验生日月日后提交，保留历法选择以便连续录入家人生日。 */
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !birthday) return;
    onAdd(name.trim(), birthday);
    setName("");
  };
  return (
    <div
      className="sync-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="sync-dialog birthdays-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="家人生日"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="sync-dialog-head">
          <h3>🎂 家人的小日子</h3>
          <button className="remove" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <p className="sync-hint">提前一天 20:00 想好祝福，当天 09:00 记得说生日快乐。</p>
        <ul className="birthday-list">
          {alive.map((ann) => (
            <li key={ann.id} className="birthday-card">
              <span className="birthday-avatar" aria-hidden="true">
                🎁
              </span>
              <div>
                <strong>{ann.name}</strong>
                <p>{birthdayLabel(ann.birthday!)}</p>
                <small>下次生日：{nextBirthday(ann.birthday!, today)}</small>
              </div>
              <button
                type="button"
                className="remove"
                onClick={() => onRemove(ann.id)}
                aria-label={`删除${ann.name}的生日`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        {alive.length === 0 && (
          <p className="birthday-empty">🍰 把在意的人记下来，让每一份祝福都准时。</p>
        )}
        <form className="birthday-form" onSubmit={submit}>
          <label>
            家人称呼
            <input
              autoFocus
              required
              maxLength={20}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：妈妈"
            />
          </label>
          <label>
            生日历法
            <select
              value={calendar}
              onChange={(e) => setCalendar(e.target.value as Birthday["calendar"])}
            >
              <option value="solar">公历（阳历）</option>
              <option value="lunar">农历（阴历）</option>
            </select>
          </label>
          <div className="birthday-date-fields">
            <label>
              月份
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, n) => (
                  <option key={n} value={n + 1}>
                    {n + 1}月
                  </option>
                ))}
              </select>
            </label>
            <label>
              日期
              <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {Array.from({ length: calendar === "lunar" ? 30 : 31 }, (_, n) => (
                  <option key={n} value={n + 1}>
                    {n + 1}日
                  </option>
                ))}
              </select>
            </label>
          </div>
          {calendar === "lunar" && (
            <label className="birthday-leap">
              <input
                type="checkbox"
                checked={leapMonth}
                onChange={(e) => setLeapMonth(e.target.checked)}
              />
              这是闰月生日
            </label>
          )}
          {!birthday && <p role="alert">这个月份没有该日期，请重新选择。</p>}
          <button className="add-btn" type="submit" disabled={!name.trim() || !birthday}>
            ＋ 记住这个生日
          </button>
        </form>
        <p className="sync-hint birthday-policy">
          每年按所选历法计算。2 月 29 日在平年按 2 月 28
          日；农历三十遇小月按廿九；没有对应闰月时按普通月份。
        </p>
        <p className="sync-hint">
          提醒使用设备本地时间。网页需保持打开，客户端需保持运行。上午提醒可在 12:00
          前补发；账号登录后生日随日历同步。
        </p>
      </section>
    </div>
  );
}
