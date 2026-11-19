import { Pool, type PoolClient } from "pg";
import type { DiaryEntry, DiaryInput } from "../../src/lib/diary.ts";
export class DiaryConflict extends Error {}
export type IndexedDiary = DiaryEntry & { accountId: string };
const fields =
  'diary_date AS date,title,content,revision,created_at AS "createdAt",updated_at AS "updatedAt",deleted';
/** 将数据库返回的时间戳转换为 JavaScript 数值。 */
function entry(row: DiaryEntry): DiaryEntry {
  return { ...row, createdAt: Number(row.createdAt), updatedAt: Number(row.updatedAt) };
}

export class DiaryStore {
  readonly pool: Pool;
  /** 创建带连接数和超时限制的 PostgreSQL 连接池。 */
  constructor(url: string) {
    this.pool = new Pool({
      connectionString: url,
      max: 4,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    this.pool.on("error", () => console.error("日记数据库连接异常"));
  }
  /** 按需创建日记表及持久化索引任务表。 */
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS diary_entries (
      account_id TEXT NOT NULL, diary_date TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
      revision INTEGER NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(account_id,diary_date));
      CREATE TABLE IF NOT EXISTS diary_index_outbox (
      id BIGSERIAL PRIMARY KEY, account_id TEXT NOT NULL, diary_date TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt BIGINT NOT NULL DEFAULT 0,
      UNIQUE(account_id,diary_date));`);
  }
  /** 按账号和日期读取日记，未找到时返回空值。 */
  async get(accountId: string, date: string): Promise<DiaryEntry | null> {
    const r = await this.pool.query(
      `SELECT ${fields} FROM diary_entries WHERE account_id=$1 AND diary_date=$2`,
      [accountId, date],
    );
    return r.rows[0] ? entry(r.rows[0]) : null;
  }
  /** 取得账号与日期对应的事务锁后校验版本，将日记修改和索引任务一起提交。 */
  async write(accountId: string, date: string, input: DiaryInput, deleted = false) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        JSON.stringify([accountId, date]),
      ]);
      const old = await c.query(
        `SELECT ${fields} FROM diary_entries WHERE account_id=$1 AND diary_date=$2`,
        [accountId, date],
      );
      const current: DiaryEntry | undefined = old.rows[0];
      if ((current?.revision ?? 0) !== input.expectedRevision)
        throw new DiaryConflict("日记已被另一设备修改，请先载入云端版本");
      if (deleted && !current) throw new DiaryConflict("日记不存在或已更新");
      const now = Date.now();
      const r = await c.query(
        `INSERT INTO diary_entries(account_id,diary_date,title,content,revision,created_at,updated_at,deleted)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(account_id,diary_date) DO UPDATE SET
        title=EXCLUDED.title,content=EXCLUDED.content,revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at,deleted=EXCLUDED.deleted RETURNING ${fields}`,
        [
          accountId,
          date,
          deleted ? current!.title : input.title,
          deleted ? current!.content : input.content,
          (current?.revision ?? 0) + 1,
          current?.createdAt ?? now,
          now,
          deleted,
        ],
      );
      await c.query(
        `INSERT INTO diary_index_outbox(account_id,diary_date) VALUES($1,$2)
        ON CONFLICT(account_id,diary_date) DO UPDATE SET attempts=0,next_attempt=0`,
        [accountId, date],
      );
      await c.query("COMMIT");
      return entry(r.rows[0]);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  /** 在调用方事务内跳过已锁任务，认领一条到期任务并读取对应日记。 */
  async indexOne(c: PoolClient): Promise<IndexedDiary | null> {
    const job = await c.query(
      "SELECT * FROM diary_index_outbox WHERE next_attempt <= $1 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1",
      [Date.now()],
    );
    if (!job.rows[0]) return null;
    const j = job.rows[0];
    const r = await c.query(
      `SELECT ${fields} FROM diary_entries WHERE account_id=$1 AND diary_date=$2`,
      [j.account_id, j.diary_date],
    );
    return r.rows[0] ? { ...entry(r.rows[0]), accountId: j.account_id } : null;
  }
  /** 为全部日记创建或重置索引任务，保留数据库中的正文。 */
  async reindex() {
    await this.pool
      .query(`INSERT INTO diary_index_outbox(account_id,diary_date) SELECT account_id,diary_date FROM diary_entries
      ON CONFLICT(account_id,diary_date) DO UPDATE SET attempts=0,next_attempt=0`);
  }
  /** 关闭 PostgreSQL 连接池，释放数据库连接。 */
  async close() {
    await this.pool.end();
  }
}
