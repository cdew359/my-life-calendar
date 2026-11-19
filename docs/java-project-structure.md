# Java 三层结构与 MyBatis

2026-11-19，本地 Cloud Java 后端完成分层调整。网页、Electron、Node 后端、数据库表结构和接口协议保持原样；此次没有部署服务器。

## 目录约定

三个有数据库业务的微服务各自采用以下结构，不跨服务直接引用对方的 Service 或 DAO：

```text
src/main/java/cn/imlaomi/cloud/<业务>/
├── XxxApplication.java
├── controller/   HTTP 路由、请求上下文、委托 Service
├── service/      业务规则、流程编排、事务、后台任务
├── dao/          MyBatis Mapper、Redis 或 ES 访问
├── entity/       数据库行及索引文档
├── dto/          请求、响应和跨边界传输对象
├── util/         格式校验、JSON 兼容转换、通用工具
├── config/       Spring 配置与线程池
└── client/       Feign 服务间调用（需要时设置）

src/main/resources/
├── application.yml
└── mapper/       MyBatis XML SQL
```

调用方向为 `Controller → Service → DAO → 存储`。Controller 没有 SQL，也不直接调用 DAO。Service 不依赖 Servlet 请求对象，通过 Controller 提取账号、日期、来源 IP 等参数。只有一种实现的 Service 直接使用具体类，不额外建立接口和 impl 层。

`common` 没有独立数据库业务，按 `config`、`exception`、`security`、`dto`、`util` 组织。Gateway 只有转发配置和健康接口，按 `config`、`controller`、`dto` 组织，没有空置的 Service、DAO。

## 从哪里开始读

| 业务 | Controller | Service | DAO / SQL |
| --- | --- | --- | --- |
| 账号 | `UserController` | `UserService` | `AccountDao` / `AccountDao.xml`；`LoginAttemptDao` 封装 Redis |
| 日历 | `CalendarController` | `CalendarService`；`CalendarMerge` 处理纯合并规则 | `CalendarStateDao` / `CalendarStateDao.xml` |
| 日记 | `DiaryController` | `DiaryService` 编排接口；`DiaryEntryService` 保证保存事务 | `DiaryEntryDao`、`DiaryOutboxDao` 及各自 XML |
| 索引任务 | 无 HTTP 入口，`IndexWorker.tick()` 定时启动 | `IndexWorker` 限制并发、创建事务、计算重试时间 | `DiaryOutboxDao`；`DiarySearchDao` 封装 ES HTTP 协议 |

日期校验在 `diary/util/DiaryDates`；令牌签名在 `common/util/Tokens`；历史 JSON 清洗在 `calendar/util/DataRules` 和 `CalendarJson`。日历合并与共享分发属于业务规则，放在 Service 中。

## MyBatis 使用方式

父 POM 统一管理 Starter 4.0.1，三个业务模块引用 Starter；当前使用 Java 17 与 Spring Boot 4.0.9。此前分层改造使用的 3.0.5 / Boot 3.5 已随 AI 功能升级，参考 [MyBatis 官方兼容表](https://mybatis.org/spring-boot-starter/mybatis-spring-boot-autoconfigure/)。

- Mapper 接口使用 `@Mapper`，由 Spring 创建代理并注入 Service。
- XML `namespace` 对应 Mapper 全名，语句 `id` 对应方法名；参数使用 `#{...}` 绑定，不拼接用户输入。
- 使用显式 constructor resultMap 映射 Java record，字段名与 SQL 列名不同也能明确对应。
- Mapper XML 位于 `classpath*:mapper/*.xml`，随 JAR 打包。
- 设置 `local-cache-scope: STATEMENT`，锁定查询禁用缓存并刷新会话缓存，避免锁定前的旧结果被再次读取。
- 不增加 JPA、MyBatis-Plus 或第二套业务数据库结构。

## 事务位置

`CalendarService.save()` 使用 `@Transactional`，先取得原有跨后端全局锁，再保存来源快照及各分享接收方快照；任意一步失败整笔回滚。

`DiaryEntryService.write()` 使用 `@Transactional`，先通过唯一键取得排他锁，再锁定读取版本、更新日记并写入 outbox；版本冲突返回 409，任务写入失败回滚正文。

`IndexWorker` 仍在每个工作线程内用 `TransactionTemplate` 建立独立事务。`FOR UPDATE SKIP LOCKED`、两个工作线程、退避重试和停机清理机制保持原样，DAO 只负责认领及更新任务。

## 验证与部署范围

本地使用 `mvn -f cloud/pom.xml clean verify` 完成编译、测试、打包。移动包路径后必须清理旧 class，避免旧 Controller 或配置类进入新 JAR。

验证包括原有 59 组同步兼容样例、HTTP 协议、登录注册和限流、线程池，以及使用 H2 MySQL 模式执行真实 Mapper XML 的账号映射、唯一约束、日历分享、日记版本、任务重试和事务回滚测试。数据库集成测试使用真实 MyBatis 与 Spring 事务代理。

H2 不能代替 MySQL 8.4、Redis、ES、Nacos 的完整联调，尤其不能据此证明生产数据库的跨进程锁竞争表现。本地未启动 Docker 数据库，也未连接或更新腾讯云；上线前应进行真实环境联调。网页和客户端不需要因目录调整重新打包。

重构前 Cloud 源码备份：`release/layer-refactor/cloud-before.tar.gz`。
