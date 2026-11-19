# Spring Cloud Java 后端

Java 业务实现，保留网页、Electron 和 Node 兼容入口的同步协议。使用 Java 17、Boot 4.0.9、Cloud 2025.1.4、Alibaba 2025.1.0.0、MyBatis Starter 4.0.1、Spring AI 2.0.2。数据服务使用 MySQL、Redis、Elasticsearch；注册和配置由 Nacos 提供。

## 模块与职责

| 模块 | 职责 | 内部端口 |
| --- | --- | --- |
| gateway | 显式公开 API 路由、服务发现与转发 | 8789 |
| user-service | 账号、bcrypt、令牌、昵称、Redis 登录限流 | 8801 |
| calendar-service | 快照合并、分享、计划草稿、日记 RAG、AI 治理 | 8802 |
| diary-service | 日记版本、事务 outbox、有界线程池、ES 检索 | 8803 |
| common | 跨服务协议、令牌、鉴权、异常与输入上限 | 无独立进程 |
| Nacos | 注册与配置，Docker 容器，非 Maven 模块 | 8848 / 9848 / 8080 |

`registry/` 是历史 Eureka 源码，不在当前构建与运行模块中。业务服务采用 [Controller → Service → DAO](../docs/java-project-structure.md)，Mapper XML 随 JAR 打包。

## 构建和测试

从根目录执行，确保 Maven 使用 JDK 17：

```sh
mvn -f cloud/pom.xml clean verify
```

得到四个业务可执行 JAR，common 为普通依赖。测试覆盖真实 MyBatis XML/H2、事务、同步协议和模拟服务，无需个人服务器、Nacos 或模型密钥。同步对照用例由 TypeScript 生成，包含旧端字段、跨天时间线和生日规则。

## 启动完整业务

完整运行依赖 MySQL、Redis、Nacos 和 ES，并在 Nacos `CALENDAR` 分组发布 `deploy/nacos-config/` 的非私密配置。密码、数据库连接和签名密钥只通过环境变量注入，见 [本地运行说明](../docs/development.md)。

`deploy/compose.yml` 是带小内存参数的部署参考，包含外部网络名称和必填环境项，需要适配自己的网络与连接，并非无需配置的一键演示。公开仓库保留可复用的示例、资源保护和备份脚本；个人服务器的一次性导入、归并和发布脚本留在本机，不作为学习环境的初始化命令。

日历按账号保存 JSON 快照；日记按账号和日期保存独立行及版本。Node 与 Java 的共享模式使用同一 MySQL 和 ES 索引，但令牌签名独立。并未将所有 Plan 拆成关系表。

## AI 与 RAG

AI 默认关闭，承载在 calendar-service 中，不新增 JVM。事件提取只生成 DTO 草稿，不直接写入日历；问答先进行当前账号范围内的 ES 召回和 MySQL 版本回查，再由 Spring AI `RetrievalAugmentationAdvisor` 传递少量材料。全文检索一期不使用向量数据库。

Node 与 diary-service 使用绑定账号、用途、有效期和完整请求体的专用 HMAC，不复用另一入口的登录 token。模型密钥只提供给 Java 后端。配额、幂等、短缓存和元数据审计见 [AI 实现说明](../docs/ai-rag-implementation.md)。

本地测试不等于真实 Nacos/数据库/模型联调，也不保证 2GB 服务器容量。源码不附带个人部署配置、业务数据和密钥。
