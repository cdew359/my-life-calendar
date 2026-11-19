import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { DiaryStore } from "./diary-store.ts";
import { DiarySearchIndex } from "./diary-search.ts";
import { DiaryService } from "./diary-service.ts";
import { mysqlPool, MysqlRepository } from "./mysql-repository.ts";
import { MysqlDiaryService } from "./mysql-diary.ts";
import { createMysqlApp } from "./mysql-app.ts";

const config = loadConfig();
const databaseUrl = process.env.DIARY_DATABASE_URL;
const elasticsearchUrl = process.env.ELASTICSEARCH_URL;
const mysqlUrl = process.env.MYSQL_URL;
if (Boolean(mysqlUrl || databaseUrl) !== Boolean(elasticsearchUrl))
  throw Error("日记服务需同时配置数据库和搜索地址");
const pool = mysqlUrl ? mysqlPool(mysqlUrl) : undefined;
const repository = pool ? new MysqlRepository(pool) : undefined;
if (repository) await repository.init();
const index = elasticsearchUrl
  ? new DiarySearchIndex(
      elasticsearchUrl,
      process.env.ELASTICSEARCH_API_KEY,
      process.env.DIARY_INDEX,
    )
  : undefined;
const diary =
  pool && index
    ? new MysqlDiaryService(pool, index)
    : databaseUrl && index
      ? new DiaryService(new DiaryStore(databaseUrl), index)
      : undefined;
if (diary) await diary.start();
const app =
  repository && diary
    ? createMysqlApp(config, repository, diary)
    : createApp(config, diary as DiaryService | undefined);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`日历表同步 API 启动: http://localhost:${info.port}`);
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    server.close(() => {
      void (async () => {
        await diary?.close();
        await pool?.end();
        process.exit(0);
      })();
    });
  });
