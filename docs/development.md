# 本地运行与部署配置

先体验 README 的文件模式，再运行数据库与 Java 服务。所有示例用于自己的本地测试账号，不连接作者的线上数据库。

## 网页与 Node

建议 Node.js 24 LTS。根目录执行 `npm ci` 和 `npm --prefix server ci`，将根目录 `.env.example` 复制为 `.env.local`，保持 `VITE_SYNC_SERVER=http://localhost:8788`。

Vite 会加载此文件；不配置时产品代码保留作者正式地址，因此本地开发应明确复制。`npm run dev:full` 同时启动 API 8788 与网页 5180。开发注册码 `dev-register` 仅用于本地试用，数据存入被忽略的 `server/data-dev/`。

需要固定后端本地配置时，在 PowerShell 启动 API 的终端中设置：

```powershell
$env:SECRET = 'local-example-change-before-real-use'
$env:REGISTER_CODE = 'local-registration-example'
npm --prefix server run dev
```

Node 不自动加载 `.env` 文件。`server/.env.example` 是模板，生产环境由自己的进程管理器或 Compose 注入变量。开发模式未指定 SECRET 时，重启会更换签名密钥，需要重新登录。

无数据库时可测试计划与文件同步。完整 Node 日记需同时配置 MySQL 和 ES；Node 的 `MYSQL_URL` 是连接 URI，Java 的同名变量是 JDBC URL，不能直接互换。

## Java 业务服务

JDK 17、Maven 3.9，IDEA 打开 `cloud/pom.xml`。先运行 `mvn -f cloud/pom.xml clean verify`，无需生产密钥或外部服务。

| 变量 | 用途 |
| --- | --- |
| `MYSQL_URL` / `MYSQL_USER` / `MYSQL_PASSWORD` | Java JDBC 连接与数据库凭据 |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | 登录限流、AI 配额与缓存 |
| `NACOS_SERVER_ADDR` / `NACOS_USERNAME` / `NACOS_PASSWORD` | 注册及配置访问 |
| `NACOS_NAMESPACE` | 命名空间，默认 public |
| `TOKEN_SECRET` | Java 登录签名，独立随机值 |
| `INTERNAL_KEY` | 既有服务间账号查询鉴权，独立随机值 |
| `REGISTER_CODE` | 自己环境的注册口令 |
| `ELASTICSEARCH_URL` / `DIARY_INDEX` | 日记索引位置与版本化名称 |

Nacos 发布 `cloud/deploy/nacos-config/` 非敏感 yml，分组 `CALENDAR`。敏感值留在环境变量中。按各模块 `application.yml` 与自己的网络确定连接；`cloud/deploy/compose.yml` 引用外部网络，需适配后使用。

新环境使用空数据库或虚构数据。个人服务器的一次性导入、数据归并和发布脚本未纳入公开仓库，不作为首次启动命令；不要向已有数据库重放旧快照。

## AI 可选配置

```dotenv
AI_ENABLED=false
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
AI_BRIDGE_SECRET=
AI_ACCOUNT_DAILY_LIMIT=20
AI_GLOBAL_DAILY_LIMIT=50
```

只有明确启用并提供密钥后才创建模型客户端。`AI_BRIDGE_SECRET` 使用至少32字符的独立随机值，Java 两服务与 Node 桥接共享；Node 另配置私网 `AI_JAVA_URL`。本机终端变量不会自动传到远端或容器。秘密不能放入 `VITE_*`、安装包或仓库。

详见 [AI 实现与限制](ai-rag-implementation.md)。模拟测试不需要真实密钥，不消耗提供商额度。

## 桌面和验证

`npm run dev:desktop` 启动开发客户端；Windows 使用 `npm run pack:win` 生成安装包。IPC 验证使用临时账号和目录，不复制个人 `%APPDATA%` 数据到仓库。安装包通过下载渠道分发，不提交 `release/`。

普通测试命令见 README。两项真实数据库/ES 集成测试需要各测试文件约定的专用配置，缺少配置时跳过。GitHub CI 不连接个人服务器，也不自动部署。
