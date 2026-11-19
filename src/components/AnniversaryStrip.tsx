import { useState } from "react";
import WeatherCard from "./WeatherCard";
import { motion } from "motion/react";
import type { UpcomingAnniversary } from "../lib/anniversaries";
import type { CityRecord } from "../lib/types";

type Props = {
  upcoming: UpcomingAnniversary[];
  hasAny: boolean;
  /** 通知父组件跳转到指定日期。 */
  onJump: (dateKey: string) => void;
  /** 将新增条目交给父组件保存。 */
  onAdd: (name: string, kind: "yearly" | "once", date: string) => void;
  /** 通知父组件移除指定条目。 */
  onRemove: (id: string) => void;
  home: CityRecord | null;
  watch: CityRecord | null;
  /** 将选定城市设置为常住城市。 */
  onSetHome: (city: CityRecord) => void;
  /** 更新或清空关注城市。 */
  onSetWatch: (city: CityRecord | null) => void;
};

/** 把纪念日日期转换成便于阅读的月日文本。 */
function formatDay(dateKey: string) {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${m}月${d}日`;
}

/** 展示临近纪念日、倒计时及城市天气入口。 */
export default function AnniversaryStrip({
  upcoming,
  hasAny,
  onJump,
  onAdd,
  onRemove,
  home,
  watch,
  onSetHome,
  onSetWatch,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [yearly, setYearly] = useState(true);

  /** 校验纪念日表单，提交新增纪念日并清空输入。 */
  const submit = () => {
    if (!name.trim() || !date) return;
    onAdd(name, yearly ? "yearly" : "once", date);
    setName("");
    setDate("");
    setAdding(false);
  };

  return (
    <div className="ann-strip">
      {upcoming.length === 0 && !adding && (
        <p className="ann-empty">
          {hasAny ? "近期没有纪念日" : "加一个纪念日或重要日子，倒计时会显示在这里"}
        </p>
      )}
      {upcoming.map((item) => (
        <motion.button
          key={item.id}
          className={item.builtin ? "ann-card builtin" : "ann-card"}
          onClick={() => onJump(item.date)}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          title={
            item.builtin
              ? `法定假期${item.days === 0 ? "（进行中）" : ""}，点击跳到假期首日`
              : `跳到 ${item.date}${item.kind === "yearly" ? "（每年重复）" : ""}`
          }
        >
          <span className="ann-name">
            {item.builtin ? "🏖 " : item.kind === "yearly" ? "🔁 " : "🎯 "}
            {item.name}
          </span>
          <span className={item.days === 0 ? "ann-days today" : "ann-days"}>
            {item.days === 0 ? (item.builtin ? "进行中" : "就是今天") : `${item.days} 天`}
          </span>
          <span className="ann-date">{formatDay(item.date)}</span>
          {!item.builtin && (
            <span
              className="ann-remove"
              role="button"
              aria-label={`删除 ${item.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.id);
              }}
            >
              ×
            </span>
          )}
        </motion.button>
      ))}

      {adding ? (
        <div className="ann-form">
          <input
            autoFocus
            className="ann-input name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="名称，如：纪念日 / 生日 / 出发日"
            maxLength={20}
          />
          <input
            className="ann-input date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <label className="ann-repeat">
            <input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} />
            每年
          </label>
          <button className="add-btn" onClick={submit} disabled={!name.trim() || !date}>
            添加
          </button>
          <button className="link-btn" onClick={() => setAdding(false)}>
            取消
          </button>
        </div>
      ) : (
        <button className="ann-add" onClick={() => setAdding(true)}>
          + 纪念日
        </button>
      )}
      <span className="ann-strip-spacer" aria-hidden="true" />
      <span className="ann-weather-group">
        <WeatherCard home={home} watch={watch} onSetHome={onSetHome} onSetWatch={onSetWatch} />
      </span>
    </div>
  );
}
