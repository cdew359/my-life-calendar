const fs = require("fs");
const p = "src/App.tsx";
let s = fs.readFileSync(p, "utf8");

// 1) import getLastSyncUser
s = s.replace(
  'import { SyncEngine, getSyncConfig, type SyncStatus } from "./lib/syncEngine";',
  'import { SyncEngine, getLastSyncUser, getSyncConfig, type SyncStatus } from "./lib/syncEngine";',
);

// 2) 统一的账号连接函数（替换两处 enable 调用）：换账号且本机有数据时先询问
s = s.replace(
  "  const showToast = useCallback((text: string) => {",
  `  /** 连接账号：换账号登录且本机有数据时先问清归属，防止 A 账号数据混进 B 账号 */
  const connectAccount = useCallback(
    (server: string, token: string, username: string) => {
      const last = getLastSyncUser();
      const local = dataRef.current;
      const localCount =
        local.plans.filter((x) => x.deletedAt === null).length +
        local.notes.filter((x) => x.deletedAt === null).length +
        local.habits.filter((x) => x.deletedAt === null).length;
      let adoptRemote = false;
      if (localCount > 0 && last !== username) {
        const owner = last ? \`账号「\${last}」\` : "本机";
        const merge = window.confirm(
          \`本机存有\${owner}的数据（\${localCount} 条）。\\n登录「\${username}」时如何处理？\\n\\n· 确定 = 把本机数据合并进「\${username}」\\n· 取消 = 不合并，本机数据将被「\${username}」的云端数据覆盖\`,
        );
        adoptRemote = !merge;
      }
      localStorage.removeItem("calendar.sync.skipped");
      setLocalMode(false);
      engineRef.current!.enable(server, token, username, { adoptRemote });
      setSyncUser(username);
      setSyncConfigured(true);
      refreshAccounts();
    },
    [refreshAccounts],
  );

  const showToast = useCallback((text: string) => {`,
);

// 3) 两处 onConnect 改用 connectAccount
s = s.replace(
  `        onConnect={(server, token, username) => {
          localStorage.removeItem("calendar.sync.skipped");
          setLocalMode(false);
          engineRef.current!.enable(server, token, username);
          setSyncUser(username);
          setSyncConfigured(true);
          refreshAccounts();
        }}`,
  `        onConnect={connectAccount}`,
);
s = s.replace(
  `                onConnect={(server, token, username) => {
                  localStorage.removeItem("calendar.sync.skipped");
                  setLocalMode(false);
                  engineRef.current!.enable(server, token, username);
                  setSyncUser(username);
                  setSyncConfigured(true);
                  refreshAccounts();
                  setSyncOpen(false);
                }}`,
  `                onConnect={(server, token, username) => {
                  connectAccount(server, token, username);
                  setSyncOpen(false);
                }}`,
);

fs.writeFileSync(p, s);
console.log("guard wired");
