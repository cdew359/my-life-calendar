import { useState } from "react";
import { motion } from "motion/react";
import { apiLogin, apiRegister } from "../lib/api";
import { DEFAULT_SYNC_SERVER } from "../lib/config";
import type { SyncStatus } from "../lib/syncEngine";

type Props = {
  status: SyncStatus;
  configured: boolean;
  selfUser: string | null;
  selfNickname: string | null;
  /** 将新昵称交给调用方保存。 */
  onSetNickname: (nickname: string) => Promise<void>;
  /** 将服务器地址和登录凭据交给调用方，建立同步连接。 */
  onConnect: (server: string, token: string, username: string) => void;
  /** 通知调用方解除当前同步连接。 */
  onDisconnect: () => void;
  /** 请求调用方立即执行一次云端同步。 */
  onSyncNow: () => void;
  /** 通知父组件关闭当前面板。 */
  onClose: () => void;
};

/** 把最近同步时间转换为面板中的可读文本。 */
function timeLabel(ts: number | null) {
  if (!ts) return "尚未同步";
  const d = new Date(ts);
  return `最近同步 ${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

/**
 * 同步弹框：已连接显示状态/立即同步/退出登录；
 * 未连接（桌面端首次使用）输入服务器地址、账号与密码连接。
 */
export default function SyncPanel({
  status,
  configured,
  selfUser,
  selfNickname,
  onSetNickname,
  onConnect,
  onDisconnect,
  onSyncNow,
  onClose,
}: Props) {
  const [nickDraft, setNickDraft] = useState<string | null>(null);
  const [nickBusy, setNickBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  // 桌面端预填内置服务器地址；网页版留空（连接时自动用当前站点）
  const [server, setServer] = useState(() =>
    import.meta.env?.VITE_CLOUD_TRIAL === "true" ||
    (typeof window !== "undefined" && window.desktopAPI)
      ? DEFAULT_SYNC_SERVER
      : "",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 保存修改后的昵称，并显示保存结果。 */
  const saveNick = async () => {
    if (nickDraft === null || nickBusy) return;
    setNickBusy(true);
    try {
      await onSetNickname(nickDraft.trim());
      setNickDraft(null);
    } catch {
      setNickBusy(false);
    }
  };

  /** 根据注册或登录模式获取令牌，随后建立同步连接。 */
  const connect = async () => {
    if (mode === "register") {
      if (password !== confirm) {
        setError("两次输入的密码不一致");
        return;
      }
      if (!code.trim()) {
        setError("请输入注册码");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      // 网页版默认同源；桌面端是 file:// 协议没有可用 origin，必须显式填地址
      const fallback = window.location.protocol.startsWith("http") ? window.location.origin : "";
      const normalized = server.trim() || fallback;
      if (!normalized) throw new Error("请输入服务器地址");
      if (!username.trim()) throw new Error("请输入账号");
      const token =
        mode === "login"
          ? await apiLogin(normalized, username.trim(), password)
          : await apiRegister(
              normalized,
              username.trim(),
              password,
              code.trim(),
              nickname.trim() || undefined,
            );
      onConnect(normalized, token, username.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
      setBusy(false);
    }
  };

  return (
    <div
      className="sync-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="sync-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="多端同步"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
      >
        <div className="sync-dialog-head">
          <h3>多端同步</h3>
          <button className="remove" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {configured ? (
          <>
            <div className="sync-account">
              <span className="sync-account-name">
                {selfNickname ? `${selfNickname}（{selfUser}）` : (selfUser ?? "")}
              </span>
              {nickDraft === null ? (
                <button className="link-btn" onClick={() => setNickDraft(selfNickname ?? "")}>
                  改昵称
                </button>
              ) : (
                <span className="sync-nick-edit">
                  <input
                    className="sync-input nick"
                    value={nickDraft}
                    autoFocus
                    maxLength={24}
                    placeholder="昵称"
                    onChange={(e) => setNickDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveNick();
                      if (e.key === "Escape") setNickDraft(null);
                    }}
                  />
                  <button className="link-btn" onClick={() => void saveNick()} disabled={nickBusy}>
                    {nickBusy ? "保存中…" : "保存"}
                  </button>
                  <button className="link-btn" onClick={() => setNickDraft(null)}>
                    取消
                  </button>
                </span>
              )}
            </div>
            <p className={`sync-status ${status.state}`}>{timeLabel(status.lastSyncAt)}</p>
            {status.message && <p className="sync-error">{status.message}</p>}
            <div className="sync-actions">
              <button
                className="today-btn"
                onClick={onSyncNow}
                disabled={status.state === "syncing"}
              >
                {status.state === "syncing" ? "同步中…" : "立即同步"}
              </button>
              <button className="link-btn" onClick={onDisconnect}>
                退出登录
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sync-hint">
              {mode === "login" ? "登录账号，开启三端数据互通" : "凭注册码开一个新账号"}
            </p>
            <input
              className="sync-input"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="https://cal.imlaomi.cn"
              autoFocus
            />
            <input
              className="sync-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password) void connect();
              }}
              placeholder="账号"
              maxLength={24}
            />
            <input
              className="sync-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password) void connect();
              }}
              placeholder="密码"
              maxLength={64}
            />
            {mode === "register" && (
              <>
                <input
                  className="sync-input"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && password) void connect();
                  }}
                  placeholder="昵称（可选，展示给别人看的名字）"
                  maxLength={24}
                />
                <input
                  className="sync-input"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && password) void connect();
                  }}
                  placeholder="确认密码"
                  maxLength={64}
                />
                <input
                  className="sync-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && password) void connect();
                  }}
                  placeholder="注册码（向服务器主人获取）"
                  maxLength={32}
                />
              </>
            )}
            {error && <p className="sync-error">{error}</p>}
            <div className="sync-actions">
              <button
                className="add-btn"
                onClick={() => void connect()}
                disabled={busy || !password}
              >
                {busy
                  ? mode === "login"
                    ? "登录中…"
                    : "注册中…"
                  : mode === "login"
                    ? "登录"
                    : "注册并登录"}
              </button>
              <button
                className="link-btn"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setError(null);
                }}
              >
                {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
