import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { apiAccounts, type AccountInfo } from "../lib/api";
import { getSyncConfig } from "../lib/syncEngine";

type Props = {
  /** 当前绑定的账号 */
  current: string[];
  /** 自己的账号名（列表里不显示） */
  self: string | null;
  /** 将用户修改后的值交给父组件。 */
  onChange: (usernames: string[]) => void;
  /** 通知父组件关闭当前面板。 */
  onClose: () => void;
};

/** 绑定弹框（居中模态）：选择让哪些账号同步获得这条信息，点击即生效 */
export default function SharePicker({ current, self, onChange, onClose }: Props) {
  const [accounts, setAccounts] = useState<AccountInfo[] | null>(null);
  const [selected, setSelected] = useState<string[]>(current);

  useEffect(() => {
    const cfg = getSyncConfig();
    if (!cfg) {
      setAccounts([]);
      return;
    }
    let alive = true;
    void apiAccounts(cfg.server, cfg.token)
      .then(({ users, self: serverSelf }) => {
        if (!alive) return;
        // 服务器知道 token 对应的账号，优先用它过滤自己（旧登录态没存用户名也能滤掉）
        const me = serverSelf?.username ?? self;
        setAccounts(users.filter((u) => u.username !== me));
      })
      .catch(() => {
        if (alive) setAccounts([]);
      });
    return () => {
      alive = false;
    };
  }, [self]);

  useEffect(() => {
    /** 按 Escape 关闭分享对象选择面板。 */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** 切换一个账号的选中状态，并通知调用方保存分享列表。 */
  const toggle = (u: string) => {
    const next = selected.includes(u) ? selected.filter((x) => x !== u) : [...selected, u];
    setSelected(next);
    onChange(next);
  };

  return (
    <div
      className="share-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="选择同步给的账号"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
      >
        <div className="share-dialog-head">
          <h3>同步给</h3>
          <button className="remove" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {accounts === null && <p className="share-empty">加载账号…</p>}
        {accounts !== null && accounts.length === 0 && (
          <p className="share-empty">服务器上还没有其他账号，先把注册码给家人注册吧</p>
        )}
        {accounts?.map((u) => {
          const on = selected.includes(u.username);
          return (
            <button
              key={u.username}
              className={on ? "share-option on" : "share-option"}
              onClick={() => toggle(u.username)}
              aria-pressed={on}
            >
              <span className="share-check" aria-hidden="true">
                {on ? "✓" : "＋"}
              </span>
              {u.nickname || u.username}
            </button>
          );
        })}
      </motion.div>
    </div>
  );
}
