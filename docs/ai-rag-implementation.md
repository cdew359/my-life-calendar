# AI 计划草稿与日记问答

2026-11-19。本地实现，尚未发布服务器；不读取旧快照覆盖当前业务数据。

## 已实现

- Java 17，Boot 4.0.9、Spring AI 2.0.2、Cloud 2025.1.4、Alibaba 2025.1.0.0、MyBatis 4.0.1，迁移 Jackson 3，并保持既有同步 DTO 协议。
- 日历页的「AI 小助手」同时服务网页与 Electron。「一句话写计划」仅生成草稿；用户可以修改日期、事项、分类及时间，再选择保存。最多五条；不自动分享或创建提醒。
- “今天、明天”等按服务端北京时间解释，界面显示参考日期。无具体日期使用当前选中日期；模糊时间保留为文字，歧义条目默认不勾选。起止时间明确时由 Java 计算跨天分钟，不信任模型计算结果。
- 批量保存先整批校验再一次落盘。稳定 ID 防止重复确认、覆盖已编辑事项或复活删除项。账号切换时丢弃旧界面结果。旧客户端缺少新 IPC 时会提示升级。
- 「问问日记」需要问题、关键词和日期范围。当前账号的 ES 全文召回最多二十候选，逐条回查 MySQL 版本与删除状态，最多五个片段、每个一千字，交给 Spring AI 的 `RetrievalAugmentationAdvisor`。
- 回答由结构化结论与来源编号组成；程序校验每条引用，来源可以打开本人对应日期的日记。没有检索结果不调用模型。显式完整统计问题会拒绝，其他回答也只声明覆盖相关片段。
- 模型完成后及缓存重放时重新检查日记版本，引用修改或删除则要求重新提问。不自动读取尚未保存到云端的日记草稿。

时间信息仍是 Plan 的文字；现有倒推时间线不改变。计划先保存本机，之后按原机制「立即同步」；日记仍直接保存云端。本期没有 Embedding、向量索引、工具执行和长期对话记忆。

## 代码阅读路径

| 位置 | 职责 |
| --- | --- |
| `src/components/AiPanel.tsx` | 共用入口、明确发送提示、预览编辑、来源跳转、取消与账号保护 |
| `src/lib/ai.ts` / `aiPlans.ts` | 响应边界校验、时间文字、原子批量与幂等 |
| `server/src/ai-routes.ts` | 正式 Node 入口先沿用登录鉴权，再签发专用服务凭据 |
| `cloud/calendar-service/.../controller/` | 公开 Cloud API 与内部 Node 桥接 API |
| `.../service/AiEventService.java` | 日期锚点、提示词、计划草稿编排 |
| `.../service/KnowledgeService.java` | 检索、模型回答、来源检查和再次验证 |
| `.../client/DeepSeekEventAiClient.java` | ChatClient、严格结构转换和 RAG Advisor |
| `.../service/AiRequestService.java` | 持久化请求身份、配额、短期缓存、审计 |
| `cloud/diary-service/.../service/DiaryRetrievalService.java` | 账号范围内的检索和 MySQL 权威回查 |
| `cloud/common/.../util/AiBridgeTokens.java` | 绑定账号、用途、请求体摘要与有效期的 HMAC |

API：`GET /api/ai/capabilities`、`POST /api/ai/events/interpret`、`POST /api/ai/knowledge/ask`。Cloud 由网关显式路由；`/internal/ai/*` 不经公网网关。能力检测只说明部署配置，不消耗模型额度，也不保证模型实时可用。

## 成本与失败处理

默认 `AI_ENABLED=false`。服务端远程 DeepSeek `deepseek-flash`，关闭思考模式，JSON 对象响应，最多 1800 输出 token，无工具调用、无 HTTP 自动重试。连接超时三秒、响应读取超时二十五秒，并限制读取时间窗口与累计 1MB 响应体；这是读取保护，不是严格的二十五秒端到端保证。前端与 Node 等待三十五秒；停止等待不保证提供商尚未产生费用。

Redis 全站一个在途名额，九十秒租约；账号默认每天二十次、全站五十次，北京时间切日。当前实现保守统计被认领的请求：失败、检索无证据及并发拒绝可能占用或在 Redis 重建计数时计入次数，不表示真实调用次数或账单。数据库恢复失败或 Redis 不可用时暂停 AI。

MySQL 新增独立 `cloud_ai_requests` 表，唯一键 `(account_id, request_id)`。只存 HMAC 指纹、模型、状态、时间和可获得的 token 用量，不存原文与推理；每小时最多清理五百条三十天前审计。幂等记录保留窗口为三十天。Redis 按账号和请求缓存正文十分钟；使用受控私网与密码。

相同请求只复用成功缓存；内容不符返回 409，成功但缓存已过期返回 410，失败或状态未知不自动再次调用。用户再次点击生成会创建新的请求，可能再次消耗额度。不会自动恢复失败费用，也不把未知 token 记成零。

## 启用与发布

本机 Windows 用户/系统环境变量不会自动出现在已启动的终端、远端服务器或 Docker 容器中。密钥只注入后端，不能使用 `VITE_*`，也不能写入公共 Nacos、安装包或代码。

部署前使用现有一致性备份流程，保留旧镜像与配置。新增表由 calendar-service 的 schema 初始化创建，不迁移或重写日历、日记表。

Cloud 私有 `.env` 配置：

```dotenv
AI_ENABLED=true
DEEPSEEK_API_KEY=填写后端密钥
DEEPSEEK_MODEL=deepseek-flash
AI_BRIDGE_SECRET=生成独立的至少32字符随机密钥
AI_ACCOUNT_DAILY_LIMIT=20
AI_GLOBAL_DAILY_LIMIT=50
```

`cloud/deploy/compose.yml` 已将模型密钥仅提供给 calendar-service；桥接密钥提供给 calendar-service 与 diary-service。calendar-service 新增 Redis 配置和无宿主端口的出站网络，以便访问 DeepSeek。原数据库、Redis、Nacos 私密配置继续沿用。

正式 Node 与 Cloud 登录密钥不同，不能直接转用 token。正式入口需设置：

```dotenv
AI_JAVA_URL=http://calendar-service:8802
AI_BRIDGE_SECRET=与Java两服务相同的专用密钥
```

`server/deploy/ai-bridge.compose.yml` 是可选叠加配置，将 `calendar-sync` 加入 Cloud 的内部网络；先确认运行项目的实际网络名是否为 `calendar-cloud-trial_private`。与正式部署的现有 compose 一起加载，保留原共享 MySQL、ES、域名等所有叠加配置。不要把内部 8802/8803 端口直接发布公网，也不要单独用旧 standalone 配置替换现网完整配置。

构建步骤：根目录 `npm run build`、`npm --prefix server run typecheck`；JDK 17 下 `mvn -f cloud/pom.xml clean verify` 得到四个可执行 JAR。桌面安装包用 `npm run pack:win` 单独生成；本期未发布或安装新包。正式网页与 Cloud 网页需要分别使用各自既有构建参数。先更新 Java 服务与 Node 桥接，再发前端；检查普通登录、同步、日记、AI 两条链路和服务器内存。

回退优先 `AI_ENABLED=false`。需要回退代码时还原旧服务镜像和前端，不覆盖期间新产生的业务数据。共用 MySQL 不得停止或删除卷。

## 验证

覆盖 Boot 4 上下文启动、无模型密钥关闭启动、真实 MyBatis 审计 SQL、HMAC 跨语言协议、输入与时间校验、幂等与配额、失败不重试、无证据不调用、伪造引用与旧缓存失效。DeepSeek 使用本机模拟 HTTP，验证实际请求协议、关闭思考、JSON、输出限制、用量和 RAG 上下文；没有调用真实付费模型。

网页与 Electron 使用同一套批量逻辑测试。`scripts/test-ai-ui.cjs` 在隔离临时数据目录里使用真实 React/Electron 页面，测试显式生成、默认不选歧义、保存、原文跳转、故障保留与登录会话改变；也检查窄屏横向溢出。运行需本地 Vite 5188 端口及测试页 `tests/ui/ai.html`，完全使用假数据。

真实 MySQL/ES 的两项 Node 集成测试需要专用环境，缺少配置时跳过。尚未完成真实 Nacos/MySQL/Redis/ES/DeepSeek 的整链路部署联调，也未验证 2GB 服务器的升级后容量。上述通过的本地测试不替代这些上线检查。
