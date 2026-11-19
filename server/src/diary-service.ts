import { DiaryStore } from "./diary-store.ts";
import { DiarySearchIndex } from "./diary-search.ts";
import type { DiarySearch } from "../../src/lib/diary.ts";
export class DiaryService {
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  /** 组合 PostgreSQL 日记存储与搜索索引客户端。 */
  constructor(
    readonly store: DiaryStore,
    readonly searchIndex: DiarySearchIndex,
  ) {}
  /** 初始化日记表，并启动周期性的索引补偿任务。 */
  async start() {
    await this.store.init();
    this.timer = setInterval(() => void this.flush(), 3000);
    this.timer.unref();
    void this.flush();
  }
  /** 合并重复的索引处理请求，确保同一服务实例只执行一轮后台任务。 */
  flush(): Promise<void> {
    if (this.running) return this.running;
    const run = this.process();
    this.running = run;
    void run.finally(() => {
      if (this.running === run) this.running = null;
    });
    return run;
  }
  /** 在事务中认领 outbox 任务并写入 ES；成功后移除任务，失败时延后重试。 */
  private async process() {
    // Fail closed without losing the SQL outbox; retry on the next tick.
    try {
      await this.searchIndex.ensure();
      for (let i = 0; i < 20; i++) {
        const c = await this.store.pool.connect();
        try {
          await c.query("BEGIN");
          const entry = await this.store.indexOne(c);
          if (!entry) {
            await c.query("COMMIT");
            break;
          }
          try {
            await this.searchIndex.put(entry);
            await c.query("DELETE FROM diary_index_outbox WHERE account_id=$1 AND diary_date=$2", [
              entry.accountId,
              entry.date,
            ]);
          } catch {
            await c.query(
              "UPDATE diary_index_outbox SET attempts=attempts+1,next_attempt=$3+LEAST(60000,2000*power(2,LEAST(attempts,5))) WHERE account_id=$1 AND diary_date=$2",
              [entry.accountId, entry.date, Date.now()],
            );
          }
          await c.query("COMMIT");
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      }
    } catch {
      /* Persisted jobs retry; no diary contents or credentials in logs. */
    }
  }
  /** 检索后从数据库回查正文，仅返回账号、删除状态和版本都匹配的日记。 */
  async search(accountId: string, input: DiarySearch) {
    const result = await this.searchIndex.search(accountId, input);
    const rows = await Promise.all(result.hits.map((h) => this.store.get(accountId, h.date)));
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
  /** 停止索引定时器，等待当前任务完成并关闭 PostgreSQL 连接池。 */
  async close() {
    clearInterval(this.timer);
    if (this.running) await this.running;
    await this.store.close();
  }
}
