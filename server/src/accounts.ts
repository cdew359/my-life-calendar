import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface Account {
  id: string;
  username: string;
  /** 显示昵称（可选，登录名之外的叫法，分享/绑定时展示用） */
  nickname?: string;
  hash: string;
  createdAt: number;
}

interface AccountsFile {
  accounts: Account[];
}

const USERNAME_RE = /^[\p{L}\p{N}_-]{2,24}$/u;

/**
 * 账号簿：accounts.json 落盘（临时文件 + 原子重命名）。
 * 用户名唯一（大小写不敏感），密码只存 bcrypt 哈希。
 */
export class AccountBook {
  private file: string;
  private accounts: Account[] = [];

  /** 从指定目录加载账号 JSON 文件，文件缺失或损坏时以空账号簿启动。 */
  constructor(dataDir: string) {
    this.file = path.join(dataDir, "accounts.json");
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as AccountsFile;
      if (raw && Array.isArray(raw.accounts)) {
        this.accounts = raw.accounts.filter(
          (a) =>
            a &&
            typeof a.id === "string" &&
            typeof a.username === "string" &&
            typeof a.hash === "string",
        );
      }
    } catch {
      // 文件不存在或损坏 → 空账号簿
    }
  }

  /** 返回当前账号簿中的账号数量。 */
  get size(): number {
    return this.accounts.length;
  }

  /** 返回账号簿中的完整账号记录，供服务端内部查询与分享分发使用。 */
  all(): Account[] {
    return this.accounts;
  }

  /** 先写入临时文件再原子重命名，保存完整账号簿。 */
  private persist() {
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ accounts: this.accounts }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** 注册：返回新账号；用户名已存在返回 null；用户名不合法抛错 */
  register(username: string, hash: string, nickname?: string): Account | null {
    const name = username.trim();
    if (!USERNAME_RE.test(name)) {
      throw new Error("账号需 2–24 位，可用中文、字母、数字、下划线、短横线");
    }
    if (this.find(name)) return null;
    const nick = (nickname ?? "").trim().slice(0, 24);
    const account: Account = {
      id: crypto.randomBytes(6).toString("hex"),
      username: name,
      ...(nick ? { nickname: nick } : {}),
      hash,
      createdAt: Date.now(),
    };
    this.accounts.push(account);
    this.persist();
    return account;
  }

  /** 修改昵称；返回 false 表示账号不存在 */
  setNickname(id: string, nickname: string): boolean {
    const account = this.byId(id);
    if (!account) return false;
    const nick = nickname.trim().slice(0, 24);
    if (nick) account.nickname = nick;
    else delete account.nickname;
    this.persist();
    return true;
  }

  /** 大小写不敏感查找 */
  find(username: string): Account | undefined {
    const key = username.trim().toLowerCase();
    return this.accounts.find((a) => a.username.toLowerCase() === key);
  }

  /** 按账号唯一标识查找账号。 */
  byId(id: string): Account | undefined {
    return this.accounts.find((a) => a.id === id);
  }
}
