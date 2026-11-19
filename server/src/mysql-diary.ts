import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { DiaryEntry, DiaryInput, DiarySearch } from "../../src/lib/diary.ts";
import { DiaryConflict } from "./diary-store.ts";
import { DiarySearchIndex } from "./diary-search.ts";
import type { DiaryApi } from "./diary-routes.ts";

type Row = RowDataPacket & {
  date: string;
  title: string;
  content: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deleted: number;
};
const columns =
  "diary_date AS date,title,content,revision,created_at AS createdAt,updated_at AS updatedAt,deleted";
/** 将 MySQL 日记行转换为接口使用的时间戳、版本和布尔删除状态。 */
function entry(row: Row): DiaryEntry {
  return {
    date: row.date,
    title: row.title,
    content: row.content,
    revision: Number(row.revision),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    deleted: Boolean(row.deleted),
  };
}
export class MysqlDiaryStore {
  /** 组合共享 MySQL 日记存储与搜索索引客户端。 */
  constructor(readonly pool: Pool) {}
  /** 按账号与日期读取日记；写事务可选择加排他锁后检查版本。 */
  async get(
    accountId: string,
    date: string,
    c: Pool | PoolConnection = this.pool,
    lock = false,
  ): Promise<DiaryEntry | null> {
    const [rows] = await c.execute<Row[]>(
      `SELECT ${columns} FROM cloud_diary_entries WHERE account_id=? AND diary_date=?${lock ? " FOR UPDATE" : ""}`,
      [accountId, date],
    );
    return rows[0] ? entry(rows[0]) : null;
  }
  /** 先取得日记行排他锁再校验版本，在同一事务中保存正文或删除状态并写入 outbox。 */
  async write(
    accountId: string,
    date: string,
    input: DiaryInput,
    deleted = false,
  ): Promise<DiaryEntry> {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const now = Date.now();
      // Take an exclusive row lock immediately. INSERT IGNORE takes shared duplicate-key locks
      // that can deadlock when two writers both upgrade to SELECT ... FOR UPDATE.
      await c.execute(
        "INSERT INTO cloud_diary_entries(account_id,diary_date,title,content,revision,created_at,updated_at,deleted) VALUES(?,?,'','',0,?,?,FALSE) ON DUPLICATE KEY UPDATE account_id=account_id",
        [accountId, date, now, now],
      );
      const old = (await this.get(accountId, date, c, true))!;
      if (old.revision !== input.expectedRevision || (deleted && old.revision === 0))
        throw new DiaryConflict("日记已被另一设备修改，请先载入云端版本");
      const next: DiaryEntry = {
        date,
        title: deleted ? old.title : input.title,
        content: deleted ? old.content : input.content,
        revision: old.revision + 1,
        createdAt: old.createdAt,
        updatedAt: now,
        deleted,
      };
      await c.execute(
        "UPDATE cloud_diary_entries SET title=?,content=?,revision=?,updated_at=?,deleted=? WHERE account_id=? AND diary_date=?",
        [next.title, next.content, next.revision, now, deleted, accountId, date],
      );
      await c.execute(
        "INSERT INTO cloud_diary_outbox(account_id,diary_date) VALUES(?,?) ON DUPLICATE KEY UPDATE attempts=0,next_attempt=0",
        [accountId, date],
      );
      await c.commit();
      return next;
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  /** 为所有共享日记创建或重置持久化索引任务。 */
  async reindex() {
    await this.pool.query(
      "INSERT INTO cloud_diary_outbox(account_id,diary_date) SELECT account_id,diary_date FROM cloud_diary_entries ON DUPLICATE KEY UPDATE attempts=0,next_attempt=0",
    );
  }
}

/** Both runtimes claim the same durable jobs with SKIP LOCKED and ES external revisions. */
export class MysqlDiaryService implements DiaryApi {
  readonly store: MysqlDiaryStore;
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  /** 组合共享 MySQL 日记存储与搜索索引客户端。 */
  constructor(
    pool: Pool,
    readonly searchIndex: DiarySearchIndex,
  ) {
    this.store = new MysqlDiaryStore(pool);
  }
  /** 确认共享日记表可访问，并启动周期性的索引补偿任务。 */
  async start() {
    await this.store.pool.query("SELECT revision FROM cloud_diary_entries LIMIT 0");
    this.timer = setInterval(() => void this.flush(), 3000);
    this.timer.unref();
    void this.flush();
  }
  /** 合并并发的索引处理请求，避免同一服务实例重复执行后台批次。 */
  flush(): Promise<void> {
    if (this.running) return this.running;
    const run = this.process();
    this.running = run;
    void run.finally(() => {
      if (this.running === run) this.running = null;
    });
    return run;
  }
  /** 使用 SKIP LOCKED 认领共享 outbox 任务，写入 ES 后删除任务，失败时保留并延后重试。 */
  private async process() {
    try {
      await this.searchIndex.ensure();
      for (let i = 0; i < 5; i++) {
        const c = await this.store.pool.getConnection();
        try {
          await c.beginTransaction();
          const [jobs] = await c.execute<
            (RowDataPacket & {
              id: number;
              account_id: string;
              diary_date: string;
              attempts: number;
            })[]
          >(
            "SELECT id,account_id,diary_date,attempts FROM cloud_diary_outbox WHERE next_attempt<=? ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
            [Date.now()],
          );
          if (!jobs[0]) {
            await c.commit();
            break;
          }
          const job = jobs[0],
            e = await this.store.get(job.account_id, job.diary_date, c);
          try {
            if (e) await this.searchIndex.put({ ...e, accountId: job.account_id });
            await c.execute("DELETE FROM cloud_diary_outbox WHERE id=?", [job.id]);
          } catch {
            await c.execute(
              "UPDATE cloud_diary_outbox SET attempts=attempts+1,next_attempt=? WHERE id=?",
              [Date.now() + Math.min(60000, 2000 * 2 ** Math.min(job.attempts, 5)), job.id],
            );
          }
          await c.commit();
        } catch (e) {
          await c.rollback();
          throw e;
        } finally {
          c.release();
        }
      }
    } catch {
      /* Jobs remain durable; never log diary content or credentials. */
    }
  }
  /** 在 ES 命中后按账号从 MySQL 回查，仅返回未删除且版本一致的正文。 */
  async search(accountId: string, input: DiarySearch) {
    const result = await this.searchIndex.search(accountId, input),
      rows = await Promise.all(result.hits.map((h) => this.store.get(accountId, h.date)));
    const items = rows.flatMap((row, i) =>
      row && !row.deleted && row.revision === result.hits[i].revision ? [row] : [],
    );
    return {
      items,
      total: result.total,
      page: input.page,
      pageSize: 20,
      indexing: items.length !== result.hits.length,
    };
  }
  /** 停止索引定时器并等待当前批次结束；共享连接池由应用统一关闭。 */
  async close() {
    clearInterval(this.timer);
    if (this.running) await this.running;
  }
}
