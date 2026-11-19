import { useState } from "react";
import { motion } from "motion/react";
import type { Plan } from "../lib/types";
import SharePicker from "./SharePicker";

type Props = {
  plan: Plan;
  /** 通知父组件切换指定条目的状态。 */
  onToggle: () => void;
  /** 通知父组件移除指定条目。 */
  onRemove: () => void;
  /** 已登录服务器时才可绑定分享 */
  canShare: boolean;
  selfUser: string | null;
  /** 优先显示账号昵称，未设置昵称时显示账号名。 */
  displayName: (username: string) => string;
  /** 通知父组件打开条目的分享设置。 */
  onShare: (usernames: string[]) => void;
};

/** 渲染单条计划及其完成、删除和分享操作。 */
export default function PlanItem({
  plan,
  onToggle,
  onRemove,
  canShare,
  selfUser,
  displayName,
  onShare,
}: Props) {
  const [picking, setPicking] = useState(false);
  const rowClass = plan.done ? "plan done" : plan.domain === "work" ? "plan work" : "plan";
  // 收到的分享（sharedBy）只读展示，不能再转发
  const received = !!plan.sharedBy;
  return (
    <motion.li
      className={rowClass}
      layout
      initial={{ opacity: 0, y: -10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
    >
      <button
        className="check"
        onClick={onToggle}
        aria-pressed={plan.done}
        aria-label={plan.done ? "标记为未完成" : "标记为已完成"}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <motion.path
            d="M6 12.5l4 4L18 8"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ pathLength: plan.done ? 1 : 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          />
        </svg>
      </button>
      <span className="plan-text">{plan.text}</span>
      {received && <span className="shared-tag">↻ {displayName(plan.sharedBy!)}</span>}
      {!received &&
        (plan.shareWith ?? []).map((u) => (
          <span key={u} className="share-chip">
            ↗{displayName(u)}
          </span>
        ))}
      {plan.domain === "work" && <span className="domain-badge">工作</span>}
      {canShare && !received && (
        <button
          className={plan.shareWith?.length ? "share-btn has" : "share-btn"}
          onClick={() => setPicking((v) => !v)}
          aria-label="绑定账号，同步给对方"
          title="绑定账号，同步给对方"
        >
          👥
        </button>
      )}
      <button className="remove" onClick={onRemove} aria-label="删除">
        ×
      </button>
      {picking && (
        <SharePicker
          current={plan.shareWith ?? []}
          self={selfUser}
          onChange={onShare}
          onClose={() => setPicking(false)}
        />
      )}
    </motion.li>
  );
}
