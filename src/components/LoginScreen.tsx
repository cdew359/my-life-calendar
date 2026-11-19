import CalendarBuddy from "./CalendarBuddy";
import { useState } from "react";
import { motion } from "motion/react";
import { apiLogin, apiRegister, normalizeServer } from "../lib/api";

type Props = {
  /** 预填服务器地址（桌面端为内置默认值；网页端为当前站点，不显示也不可改） */
  defaultServer: string;
  /** 允许跳过登录（仅桌面端：离线本地使用） */
  allowSkip?: boolean;
  /** 跳过账号登录，进入本地使用模式。 */
  onSkip?: () => void;
  /** 将服务器地址和登录凭据交给调用方，建立同步连接。 */
  onConnect: (server: string, token: string, username: string) => void;
};

/** 账号登录：三端统一入口。账号+密码登录即互通；没有账号可凭注册码注册 */
export default function LoginScreen({ defaultServer, allowSkip, onSkip, onConnect }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const [server, setServer] = useState(defaultServer);
  const [editingServer, setEditingServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 根据当前模式提交注册或登录，并将成功得到的账号连接交给主界面。 */
  const submit = async () => {
    if (busy) return;
    const name = username.trim();
    if (!name || !password) return;
    if (mode === "register" && password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    if (mode === "register" && !code.trim()) {
      setError("请输入注册码");
      return;
    }
    const normalized = normalizeServer(server);
    if (!normalized) {
      setError("服务器地址无效");
      setEditingServer(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token =
        mode === "login"
          ? await apiLogin(normalized, name, password)
          : await apiRegister(
              normalized,
              name,
              password,
              code.trim(),
              nickname.trim() || undefined,
            );
      onConnect(normalized, token, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
      setBusy(false);
    }
  };

  /** 切换登录与注册表单，并清除上一模式的提示。 */
  const switchMode = (next: "login" | "register") => {
    setMode(next);
    setError(null);
  };

  return (
    <div className="login-wrap">
      <motion.div
        className="login-card"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
      >
        <div className="login-brand">
          <span className="login-logo" aria-hidden="true">
            <CalendarBuddy />
          </span>
          <h1>日历表</h1>
          <p>把计划和小确幸，装进每一天</p>
        </div>

        <input
          className="login-input"
          value={username}
          autoFocus
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="账号"
          maxLength={24}
        />
        <input
          className="login-input"
          type="password"
          value={password}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="密码"
          maxLength={64}
        />

        {mode === "register" && (
          <>
            <input
              className="login-input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="昵称（可选，展示给别人看的名字）"
              maxLength={24}
            />
            <input
              className="login-input"
              type="password"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="确认密码"
              maxLength={64}
            />
            <input
              className="login-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="注册码（向服务器主人获取）"
              maxLength={32}
            />
          </>
        )}

        {editingServer ? (
          <input
            className="login-input server"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder="服务器地址"
            maxLength={120}
          />
        ) : null}
        {error && (
          <motion.p
            className="login-error"
            initial={{ x: 0 }}
            animate={{ x: [0, -4, 4, -2, 2, 0] }}
            transition={{ duration: 0.3 }}
          >
            {error}
          </motion.p>
        )}
        <button
          className="add-btn login-btn"
          onClick={() => void submit()}
          disabled={busy || !username.trim() || !password}
        >
          {busy ? "验证中…" : mode === "login" ? "进入" : "注册并进入"}
        </button>

        <div className="login-alt">
          {mode === "login" ? (
            <button className="link-btn" onClick={() => switchMode("register")}>
              没有账号？注册
            </button>
          ) : (
            <button className="link-btn" onClick={() => switchMode("login")}>
              已有账号？登录
            </button>
          )}
        </div>

        {allowSkip && (
          <button className="login-skip link-btn" onClick={onSkip}>
            暂不登录，仅本机使用
          </button>
        )}
        {allowSkip && !editingServer && (
          <button
            className="login-server link-btn"
            onClick={() => setEditingServer(true)}
            title={server}
          >
            服务器：{server.replace(/^https?:\/\//, "")}
          </button>
        )}
      </motion.div>
    </div>
  );
}
