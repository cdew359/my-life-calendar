# Java 业务传输对象改造

这次改造针对 `cloud/` Java 后端。接口请求、响应、服务间账号查询、日历合并、日记索引任务都使用具体类型，业务代码不再通过 `Map<String, Object>` 或原始 JSON 读取字段。

## 对象如何分工

| 位置 | 类型与用途 |
| --- | --- |
| `common/.../dto` | `AccountSummary`、`AccountExistsResponse`、`ApiErrorResponse`：跨服务共用的小型协议对象 |
| `user-service/.../dto/UserDtos` | 登录、注册、修改昵称请求，以及登录和公开资料响应 |
| `user-service/.../entity/AccountEntity` | 数据库查询的凭据记录，和公开响应分离，密码哈希不参与 JSON 输出 |
| `calendar-service/.../dto/CalendarData` | 完整日历快照，包含 Plan、DayNote、Habit、Anniversary、Birthday、Reminder、Timeline 等业务对象 |
| `calendar-service/.../dto/CalendarUploadRequest` | 日历上传请求；旧时间线能力信息只在服务内部使用，不输出给客户端 |
| `calendar-service/.../dto/CalendarStateResponse` | 日历响应：服务端版本和完整快照 |
| `diary-service/.../dto/DiaryDtos` | 保存、删除请求，以及读取、保存、搜索、重新索引的响应 |
| `diary-service/.../entity`、`dto` | `DiaryOutboxJob` 数据库任务、`DiaryIndexDocument` ES 文档、`DiarySearchResult` 搜索命中 |

这些类型主要使用 Java 17 `record`。编译器自动生成构造器、字段访问器和相等比较，代码通过 `request.content()` 等方法访问字段。`record` 的组件引用不可重新赋值；集合的深度不可变性仍需单独保证。日历快照顶层列表已做防御复制。

DTO 表达接口约定，数据库记录表达存储查询结果。它们没有直接映射为 JPA 实体，数据库访问现已使用 MyBatis，详见 [三层结构说明](java-project-structure.md)。此次没有改变数据库表结构，也没有把完整日历文档拆表。

## 为什么仍保留部分 JSON

`CalendarJson` 和 `DataRules` 负责历史客户端格式清洗，再转换为 `CalendarData`。Service 层中的 `CalendarMerge` 和共享分发使用具体业务对象。日期、删除墓碑、习惯打卡、生日规则以及旧客户端时间线保护沿用原规则。

日记请求在反序列化边界严格检查版本和正文，避免 Jackson 自动把字符串版本号或小数转成整数。业务层收到的是校验后的请求。账号文本字段也保留旧接口对非字符串输入的处理方式。`ApiErrors` 识别反序列化包装的业务异常，保留相应 HTTP 状态和提示。

ES 查询语法和映射配置属于外部系统的 JSON 协议，仍在 `DiarySearchDao` 内构造。ES 命中在边界转换成 `DiarySearchResult`，控制器不再遍历 ES 原始 JSON。令牌内部编解码仍维持既有实现。

## 兼容性与验证

对外 URL 和 JSON 字段名不变，空日记仍返回 `entry: null` 和当前版本，账号空昵称仍为 `null`，日历可选字段继续区分缺失与空值。前端和客户端无需为这次类型调整改协议。

本地验证包括：

- Maven `verify`：编译、各模块测试与可执行 JAR 打包。
- 59 组既有 TypeScript 同步兼容样例，并验证其快照经过 DTO 持久化后的再次读取。
- 计划共享完成状态、接收方删除和取消分享墓碑。
- MVC 反序列化错误、日历请求大小限制、日记保存及删除响应、旧搜索命中过滤。
- 请求密码和注册码的输出限制、数据库密码哈希与公开响应分离。
- 原线程池并发、重试、事务边界和停机测试。
- 格式与方法注释检查。

这些验证不依赖真实 MySQL、Redis、Nacos 或 Elasticsearch，不能替代上线前的真实服务联调。本次仅修改本地代码和构建产物，没有更新腾讯云服务或已安装客户端。
