import crypto from "node:crypto";
import { createPool, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import type { Account } from "./accounts.ts";
import type { StoredState } from "./store.ts";
import { coerceData, emptyData } from "../../src/lib/validate.ts";
import type { AppData, Plan, DayNote } from "../../src/lib/types.ts";
import { mergeUpload } from "./shared-merge.ts";
import { mergeSharedInto } from "./app.ts";

type AccountRow = RowDataPacket & {
  id: string;
  username: string;
  nickname: string | null;
  password_hash: string;
  created_at: number;
};
type StateRow = RowDataPacket & { version: number; payload: unknown };
export class InvalidAccountName extends Error {}
/** 把共享账号表中的密码哈希、昵称和时间戳转换为原账号模型。 */
function account(row: AccountRow): Account {
  return {
    id: row.id,
    username: row.username,
    hash: row.password_hash,
    createdAt: Number(row.created_at),
    ...(row.nickname ? { nickname: row.nickname } : {}),
  };
}
/** 创建使用 UTF-8、连接上限与连接超时的 MySQL 连接池。 */
export function mysqlPool(url: string): Pool {
  return createPool({
    uri: url,
    connectionLimit: 3,
    connectTimeout: 5000,
    charset: "utf8mb4",
    supportBigNumbers: true,
    bigNumberStrings: false,
    enableKeepAlive: true,
  });
}

/** Shares the same tables and transaction lock as the Java calendar service. */
export class MysqlRepository {
  /** 注入与 Java 服务共用的 MySQL 连接池。 */
  constructor(readonly pool: Pool) {}
  /** 检查共享账号、日历快照及事务锁表是否已准备就绪。 */
  async init() {
    await this.pool.query("SELECT id FROM cloud_calendar_lock WHERE id=1");
    await this.pool.query("SELECT id FROM cloud_accounts LIMIT 0");
    await this.pool.query("SELECT payload FROM cloud_calendar_states LIMIT 0");
  }
  /** 按稳定顺序读取共享账号，允许复用上传事务的连接。 */
  async all(connection: Pool | PoolConnection = this.pool): Promise<Account[]> {
    const [rows] = await connection.query<AccountRow[]>(
      "SELECT * FROM cloud_accounts ORDER BY created_at,id",
    );
    return rows.map(account);
  }
  /** 按唯一标识查询共享账号，未找到时返回空值。 */
  async byId(id: string): Promise<Account | undefined> {
    const [rows] = await this.pool.execute<AccountRow[]>(
      "SELECT * FROM cloud_accounts WHERE id=?",
      [id],
    );
    return rows[0] ? account(rows[0]) : undefined;
  }
  /** 按去除空白且忽略大小写的账号名查询共享账号。 */
  async find(name: string): Promise<Account | undefined> {
    const [rows] = await this.pool.execute<AccountRow[]>(
      "SELECT * FROM cloud_accounts WHERE username_key=?",
      [name.trim().toLowerCase()],
    );
    return rows[0] ? account(rows[0]) : undefined;
  }
  /** 校验账号名并保存密码哈希和昵称；账号名冲突时返回空值。 */
  async register(name: string, hash: string, nickname: string): Promise<Account | null> {
    const username = name.trim();
    if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(username))
      throw new InvalidAccountName("账号需 2–24 位，可用中文、字母、数字、下划线、短横线");
    const a: Account = {
      id: crypto.randomBytes(6).toString("hex"),
      username,
      hash,
      createdAt: Date.now(),
      ...(nickname.trim() ? { nickname: nickname.trim().slice(0, 24) } : {}),
    };
    try {
      await this.pool.execute(
        "INSERT INTO cloud_accounts(id,username,username_key,nickname,password_hash,created_at) VALUES(?,?,?,?,?,?)",
        [a.id, a.username, a.username.toLowerCase(), a.nickname ?? null, a.hash, a.createdAt],
      );
      return a;
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY") return null;
      throw e;
    }
  }
  /** 更新账号昵称，空昵称按未设置处理。 */
  async nickname(id: string, nickname: string) {
    await this.pool.execute("UPDATE cloud_accounts SET nickname=? WHERE id=?", [
      nickname.trim() || null,
      id,
    ]);
  }
  /** 读取并清洗指定账号的共享日历快照和版本，首次使用时返回空数据。 */
  async load(id: string, connection: Pool | PoolConnection = this.pool): Promise<StoredState> {
    const [rows] = await connection.execute<StateRow[]>(
      "SELECT version,payload FROM cloud_calendar_states WHERE account_id=?",
      [id],
    );
    if (!rows[0]) return { version: 0, data: emptyData() };
    const raw = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
    return { version: Number(rows[0].version), data: coerceData(raw) };
  }
  /** 在给定事务连接中新增或更新账号的日历快照及版本。 */
  private async write(id: string, state: StoredState, connection: PoolConnection) {
    await connection.execute(
      "INSERT INTO cloud_calendar_states(account_id,version,payload) VALUES(?,?,?) ON DUPLICATE KEY UPDATE version=VALUES(version),payload=VALUES(payload)",
      [id, state.version, JSON.stringify(state.data)],
    );
  }
  /** 持有跨 Node 与 Java 共用的事务锁，合并上传并分发分享副本，一起提交或回滚。 */
  async upload(id: string, payload: unknown): Promise<StoredState> {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      await c.query("SELECT id FROM cloud_calendar_lock WHERE id=1 FOR UPDATE");
      // Account list is read after the locking read, before any consistent snapshot is created.
      const accounts = await this.all(c),
        self = accounts.find((a) => a.id === id);
      if (!self) throw Error("Account missing");
      const current = await this.load(id, c);
      const state = {
        version: Math.max(Date.now(), current.version + 1),
        data: mergeUpload(payload, current.data),
      };
      await this.write(id, state, c);
      for (const other of accounts) {
        if (other.id === id) continue;
        const theirs = await this.load(other.id, c);
        const plans = mergeSharedInto<Plan>(
          self.username,
          other.username,
          state.data.plans,
          theirs.data.plans,
        );
        const notes = mergeSharedInto<DayNote>(
          self.username,
          other.username,
          state.data.notes,
          theirs.data.notes,
        );
        if (plans.changed || notes.changed)
          await this.write(
            other.id,
            {
              version: Math.max(Date.now(), theirs.version + 1),
              data: { ...theirs.data, plans: plans.list, notes: notes.list } satisfies AppData,
            },
            c,
          );
      }
      await c.commit();
      return state;
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
}
