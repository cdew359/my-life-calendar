import { DiaryStore } from "../src/diary-store.ts";
import { DiarySearchIndex } from "../src/diary-search.ts";
import { DiaryService } from "../src/diary-service.ts";
import { mysqlPool } from "../src/mysql-repository.ts";
import { MysqlDiaryService } from "../src/mysql-diary.ts";
if ((!process.env.MYSQL_URL && !process.env.DIARY_DATABASE_URL) || !process.env.ELASTICSEARCH_URL)
  throw Error("缺少日记数据库或 ES 配置");
const index = new DiarySearchIndex(
  process.env.ELASTICSEARCH_URL,
  process.env.ELASTICSEARCH_API_KEY,
  process.env.DIARY_INDEX,
);
if (process.env.MYSQL_URL) {
  const pool = mysqlPool(process.env.MYSQL_URL),
    service = new MysqlDiaryService(pool, index);
  try {
    await service.store.reindex();
    for (let i = 0; i < 10000; i++) {
      await service.flush();
      const [rows] = await pool.query<import("mysql2/promise").RowDataPacket[]>(
        "SELECT COUNT(*) AS remaining,SUM(next_attempt>?) AS delayed FROM cloud_diary_outbox",
        [Date.now()],
      );
      const remaining = Number(rows[0].remaining);
      console.log("待更新索引条目：" + remaining);
      if (!remaining) break;
      if (Number(rows[0].delayed)) throw Error("部分索引更新失败，任务已保留，检查 ES 后重试");
      if (i === 9999) throw Error("重建尚未完成，重新运行即可继续");
    }
  } finally {
    await service.close();
    await pool.end();
  }
} else {
  const service = new DiaryService(new DiaryStore(process.env.DIARY_DATABASE_URL!), index);
  try {
    await service.store.init();
    await service.store.reindex();
    for (let i = 0; i < 10000; i++) {
      await service.flush();
      const remaining = Number(
        (await service.store.pool.query("SELECT count(*) FROM diary_index_outbox")).rows[0].count,
      );
      console.log("待更新索引条目：" + remaining);
      if (!remaining) break;
      const delayed = Number(
        (
          await service.store.pool.query(
            "SELECT count(*) FROM diary_index_outbox WHERE next_attempt>$1",
            [Date.now()],
          )
        ).rows[0].count,
      );
      if (delayed) throw Error("部分索引更新失败，任务已保留，检查 ES 后重试");
      if (i === 9999) throw Error("重建尚未完成，重新运行即可继续");
    }
  } finally {
    await service.close();
  }
}
