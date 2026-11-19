# AI 事件录入与 Spring Boot 4 升级方案

设计日期：2026-11-19，时区 Asia/Shanghai。

状态：一期本地实现已完成。本文保留原始设计与候选说明；实际交付范围、测试和部署要求以 [AI 与日记问答实现](ai-rag-implementation.md) 为准。尚未发布服务器，未使用真实模型额度。

## 1. 目标与范围

把自然语言转换为可编辑的事件草稿，用户确认后，通过原有本地保存与云端同步机制创建计划。通过这个功能学习 Spring AI、提示词、结构化输出、模型调用治理，以及 AI 与业务系统的边界。

第一期将“事件”具体定义为日历中的计划 Plan，入口位于每日计划录入区。普通录入继续可用，新增明确的“AI 整理”按钮；不会在每次键盘输入或普通保存时调用模型。

示例：以北京时间 2026-11-19 为参考，输入：

> 明天下午三点和小王开项目会，预计一个半小时，晚上买牛奶。

预览两条草稿：

| 日期 | 事项 | 分类 | 时间信息 |
| --- | --- | --- | --- |
| 2026-11-20 | 和小王开项目会 | 工作 | 15:00，预计 90 分钟 |
| 2026-11-20 | 买牛奶 | 生活 | 晚上，具体时间待填写 |

用户可以修改、取消某条草稿，然后点击“保存所选计划”。未确认的草稿不进入日历；不自动分享、不自动创建提醒、不修改已有事项。

后续迭代：每日记录整理、AI 生成时间预排步骤、只读工具查询现有安排。根据后续确认，全文日记 RAG 已纳入本期；向量检索、长期对话记忆和自动执行代理仍属后续范围。

## 2. 基础框架升级

用户已选择 Spring AI 2.0，同时升级 Spring Boot。升级前工程为 Java 17、Boot 3.5.16、Cloud 2025.0.3、Alibaba 2025.0.0.0、MyBatis Starter 3.0.5。

截至设计日，已检查官方兼容系列与 Maven Central 已发布制品，提出以下候选组合：

| 组件 | 候选版本 | 说明 |
| --- | --- | --- |
| Java | 保留 17 | 本次先控制迁移范围，不同时升级语言版本 |
| Spring Boot | 4.0.9 | 选择与现有 Nacos 接入组件对应的 Boot 4.0 分支 |
| Spring AI | 2.0.2 | 满足用户要求的 2.0 系列 |
| Spring Cloud | 2025.1.4 | Boot 4.0 对应的发布列车 |
| Spring Cloud Alibaba | 2025.1.0.0 | 官方 2025.1 分支对应 Boot 4.0 / Cloud 2025.1 |
| MyBatis Starter | 4.0.1 | 升级到 Boot 4 对应系列 |
| Nacos Server / MySQL / Redis / ES | 暂保留既有部署 | 验证新版客户端与现有服务端的连接、鉴权和行为后再决定是否调整 |

以上版本已用于本地构建与测试，尚未验证生产联调和低内存部署容量。Boot 4.1 不是本次目标，因为此次需要先满足 Alibaba 官方对应的完整组合；后续升级单独评估。

依据：[Spring AI 2.0 入门兼容说明](https://docs.spring.io/spring-ai/reference/getting-started.html)、[Spring Cloud 版本对应关系](https://spring.io/projects/spring-cloud/)、[Alibaba 2025.x 版本说明](https://sca.aliyun.com/en/docs/2025.x/overview/version-explain/)、[MyBatis 兼容表](https://mybatis.org/spring-boot-starter/mybatis-spring-boot-autoconfigure/)。具体补丁制品已查询 Maven Central metadata，实施前再次核对并锁定，不使用动态版本。

### 2.1 需要实际迁移的内容

- 父 POM 统一管理 Boot、Cloud、Alibaba、MyBatis 和 Spring AI BOM，先检查依赖树和重复依赖。
- 按 Boot 4 的模块化变化调整 Web MVC、网关、测试和相关 starter/import，而不是只修改版本号。
- 迁移 Jackson：默认按 Jackson 3 适配项目自定义序列化与反序列化代码；不能对整个 `com.fasterxml.jackson` 包简单做字符串替换，注解等需要分别核对。
- 逐项验证 `CalendarUploadRequest`、日记版本反序列化、账号文本处理、DTO null/缺失字段、数字时间戳以及错误响应。
- 验证 HMAC 令牌与 Node 的协议兼容，不顺带统一正式端和 Cloud 端的令牌密钥。
- 验证 MyBatis XML、Spring 事务代理、`FOR UPDATE`、`SKIP LOCKED`、Nacos 配置导入、Feign、Gateway 路由和跨域。
- 检查 Docker 构建及运行镜像，保留可运行的旧 JAR/镜像和环境配置。

参考：[Spring Boot 4.0 迁移指南](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)。

框架升级阶段不增加 AI 功能，先使原有 31 项 Java 测试与其中的 59 组同步兼容样例通过，再进行真实 MySQL / Redis / Nacos / ES 联调。此前 31 项通过的结果属于 Boot 3.5 版本，不能当作升级后的验证结果。

## 3. AI 放在现有 calendar-service

第一期不新增独立 AI JVM。使用现有 calendar-service 承载 AI 业务，调用远程 DeepSeek API，本机不部署模型。

```text
React 网页 / Electron 客户端
           |
     AI 事件录入面板
           |
   当前登录入口的 API
           |
 AiEventController → AiEventService → EventAiClient
                         |                  |
                 DTO 校验、日期规则      Spring AI ChatClient
                 限流、幂等、审计             |
                         |              DeepSeek API
                MyBatis / Redis
           |
     返回可编辑草稿
           |
    用户确认、批量本地保存
           |
     原有日历同步与分享机制
```

保持三层结构：

```text
calendar-service/
  controller/AiEventController.java
  controller/InternalAiEventController.java
  service/AiEventService.java
  service/AiDraftValidationService.java
  service/AiUsageService.java
  client/EventAiClient.java
  client/DeepSeekEventAiClient.java
  dao/AiRequestDao.java
  dao/AiQuotaDao.java
  entity/AiRequestEntity.java
  dto/AiEventRequest.java
  dto/AiEventResponse.java
  dto/AiEventDraft.java
  dto/ModelEventExtraction.java
  config/AiConfig.java
  config/AiProperties.java
  util/AiRequestFingerprint.java
  resources/mapper/AiRequestDao.xml
  resources/prompts/event-extract-v1.st
```

模型返回对象、服务端响应对象、数据库记录分离。`EventAiClient` 隔离提供商细节，Spring AI 的类型不扩散到 Controller 和整个日历业务中。用于外部协议的动态参数只存在于适配边界，业务接口继续使用具体 DTO。

## 4. DeepSeek 接入

Boot 4 升级通过后，引入 Spring AI BOM 2.0.2 和 `spring-ai-starter-model-deepseek`，以原生 DeepSeek 适配器接入。

- API Key：`DEEPSEEK_API_KEY`。
- 服务地址：`https://api.deepseek.com`，只接受服务端固定配置，不接受前端传入任意地址。
- 候选模型：`deepseek-flash`，通过配置指定；发布前进行一次明确启用的模型连通性与协议测试。
- 第一阶段选择非思考模式，显式传递 `thinking.type=disabled`，避免依赖提供商默认值。
- 使用 JSON Object 输出模式；提示词包含 JSON 要求及对象格式；应用层再次严格验证 DTO。
- 输出上限建议 1,800 tokens；第一期不开流式展示，完整校验后一次返回草稿。
- 不请求、不展示、不记录模型推理过程；只使用最终结果和用量元数据。

DeepSeek 官方当前列出 `deepseek-flash`，支持 JSON 输出，且思考模式默认为开启。模型名称和默认行为可能变化，因此需要配置和协议测试，不能沿用旧模型名称或假设设置低 temperature 就关闭了思考。[模型说明](https://api-docs.deepseek.com/quick_start/pricing/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)。Spring AI 的 [DeepSeek 配置说明](https://docs.spring.io/spring-ai/reference/api/chat/deepseek-chat.html) 列出了 starter、连接和思考模式参数。

结构化输出是“转换加校验”，不是业务正确性保证。需要处理空白 content、截断、错误枚举、缺失字段和不合法日期；JSON 模式也不能代替这些检查。[DeepSeek JSON 输出说明](https://api-docs.deepseek.com/guides/json_mode/)。

### 4.1 环境配置约定

建议配置项：`AI_ENABLED`、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`、`AI_MAX_INPUT_CHARS`、`AI_MAX_EVENTS`、`AI_REQUEST_TIMEOUT_SECONDS`、账号与全局每日限额。

已确认本机 User 和 Machine 环境都有 `DEEPSEEK_API_KEY`，但当前执行进程没有继承该变量；未读取其值。后续应重启开发进程或从环境安全注入 Java。Windows 本机变量不会自动进入腾讯云或 Docker 容器；部署时必须另行配置。

密钥仅提供给承载模型调用的 Java 服务，不放入 `VITE_*`、Electron 安装包、Git、公共 Nacos 配置、日志或响应。`AI_ENABLED=false` 时不创建要求密钥的模型调用 Bean，原日历服务仍应能启动。

## 5. 输入、输出与日期规则

### 5.1 建议公开接口

`POST /api/ai/events/interpret`：生成草稿，不直接创建计划。

请求示意：

```json
{
  "clientRequestId": "每次主动生成时创建的 UUID",
  "text": "明天下午三点和小王开项目会，预计一个半小时",
  "selectedDate": "2026-11-19",
  "timezone": "Asia/Shanghai",
  "defaultDomain": "life"
}
```

账号从鉴权上下文取得，模型、系统提示词、工具权限、预算均由服务端决定。

响应示意：

```json
{
  "requestId": "服务端请求标识",
  "status": "READY",
  "referenceDate": "2026-11-19",
  "timezone": "Asia/Shanghai",
  "drafts": [
    {
      "index": 0,
      "date": "2026-11-20",
      "title": "和小王开项目会",
      "domain": "work",
      "startTime": "15:00",
      "endDate": null,
      "endTime": null,
      "durationMinutes": 90,
      "unresolvedTimeText": null,
      "questions": []
    }
  ],
  "warnings": []
}
```

状态包括 `READY`、`NEEDS_CLARIFICATION`、`NO_EVENT`。数组序号由应用校验并分配，不把模型生成的 ID 当作业务 ID。

### 5.2 日期及歧义处理

- 第一期固定 Asia/Shanghai。服务端时钟确定“今天”，并在首次请求时固定参考时间；同一幂等请求不因重试跨过午夜而重新解释。
- “明天、后天、下周五”相对真实当前日期；没有日期时使用面板所选日期。预览明确显示参考日期与默认日期。
- 周以周一开始；“下周五”使用下一周的周五；“周五”一类可能歧义的表达需要明确规则或向用户澄清。
- “晚上、下午”没有具体时刻时不编造时间；保留原表达，允许用户填写，或者把原表达保留到计划文字中。
- 不自动猜测生日的农历/公历、重复周期、提醒时间、分享对象或缺失的耗时。
- 非法日期、过去日期与明显语义冲突给出提示；过去日期并非一律禁止，历史事项仍可记录。
- 同时给出开始、结束时间时，用 Java 计算并检查耗时；跨日需要明确结束日期，不能默认为负数或擅自跨日。

建议先让模型提取日期表达和候选值，对明确的“明天”等由程序复核；任何无法确定的结果进入澄清或编辑状态。模型生成的“置信度”不作为允许自动保存的门槛。

### 5.3 现有 Plan 没有独立时间字段

当前 Plan 持久化结构主要是 date、text、domain、完成状态及同步元数据，没有 scheduledStartAt 等字段。第一期不修改旧快照协议：

- 日期写入 `Plan.date`，分类写入 `Plan.domain`。
- 时间信息只用于草稿编辑和最终文本组合，例如 `15:00 和小王开项目会（预计90分钟）`。
- 仅有“晚上”等模糊表达时保留为文字。
- 不声称此时已创建定时提醒、时间冲突检测或正式的时段预约。

第二期生成已有 Timeline 格式，才能利用结构化步骤、耗时和横向时间轴；如将来需要普通计划独立的开始/结束时间，应另立字段迁移方案，覆盖 Node、Java、Electron 和旧客户端合并保护。

## 6. 确认保存与多端兼容

预览完成后，先整体校验用户选中的草稿，再一次性写入本地。新增批量计划业务操作，网页和 Electron 都采用同一组规则：

1. 标题、日期、分类等全部校验通过后，构造业务 Plan。
2. ID、创建时间、更新时间、完成和删除状态由应用生成，不使用模型指定值。
3. 依据账号、requestId、原始 draft index 生成稳定的去重身份；重复确认、网络恢复或程序重开时检查已有 ID，避免重复新增。已有事项不因重放而被覆盖。
4. 所选事项在一次数据修改与持久化中提交，不用循环异步保存形成半批成功。
5. 仍通过原有立即同步等入口上传；AI 解析成功不等于云端同步成功。

Electron 如需新增批量 IPC，只暴露明确的 `addPlans` 能力，保留来源校验与参数校验。不能开放任意执行或绕过主进程单点落盘。

返回结果须绑定原账号、服务器、录入会话和请求版本。等待期间切换账号、关闭录入页或改变输入时，旧结果不能直接应用到新账号或新草稿。AI 失败或取消时保留用户原文。

## 7. 正式 Node 入口和 Cloud 入口

正式端与 Cloud 端当前共用 MySQL，但使用不同签名密钥和登录令牌。不能让正式客户端把旧 token 直接发给 Cloud API，并假设能够通过鉴权。

建议两条受控路径：

- Cloud 端：现有 Cloud token → Gateway 新增精确的 `/api/ai/events/interpret` 路由 → calendar-service 正常鉴权 → AiEventService。
- 正式端：现有 Node API 验证正式 token 和账号 → 内部转发到 calendar-service 的 `/internal/ai/events/interpret` → AiEventService。

内部转发采用独立的 AI 桥接签名密钥和短期凭据，包含用途 audience、accountId、过期时间、请求 ID 和请求体摘要；Java 校验签名、用途、有效期和摘要。账号只能来自 Node 已验证的身份，不能信任浏览器自己提交的 accountId 或 `X-Account-Id`。

内部接口不通过公网 Nginx 或 Gateway 对外开放，仅走指定私网或受限回环端口；现有 Cloud 鉴权策略不放宽，原登录密钥不合并。两条路径最终使用同一套 Java 限额和幂等逻辑，防止通过切换入口绕过限制。

Cloud 被内存保护停止、AI 关闭或模型不可用时，正式端仅显示“AI 暂不可用，可继续手动录入”，普通保存、同步和日记继续走原路径。

健康接口增加受开关控制的 `ai-event-draft-v1` 能力标记；该标记代表部署具备功能，不通过每次健康检查调用模型，也不等同于上游实时可用性保证。

## 8. 数据、成本和并发

### 8.1 MySQL

不修改既有日历表。新增独立 `ai_request_log` 元数据表，通过 MyBatis 访问，建议字段：

`id`、`account_id`、`client_request_id`、`feature`、`input_fingerprint`、`model`、`prompt_version`、`status`、`input_tokens`、`output_tokens`、`latency_ms`、`finish_reason`、`error_code`、`created_at`、`finished_at`。

唯一约束 `(account_id, client_request_id)`。保留 30 天，定期清理。默认不存原始输入、模型原文、日记正文或推理过程；指纹使用服务端密钥 HMAC，避免简单文本哈希被轻易枚举。Token 缺失时记录未知，不填成零。

### 8.2 Redis

- 每账号每日配额和全局每日配额，以北京时间自然日计数，操作原子化。
- requestId 对应的短期草稿缓存，建议 10 分钟；敏感数据仅保留在受访问控制的内部 Redis。
- 请求处理中标记和短时并发限制；缺失 Redis 时 AI 功能返回不可用，不能绕过限额直接调用。

建议初始限制均可配置：每次最多 1,000 字、5 个事件，每账号每日 20 次，全站每日 50 次，同时最多 1 个模型请求。先建立可观察的试用范围，再按实际使用调整。

配额在发送提供商请求前预留；未发送的拒绝可以释放，已发送但超时等结果不确定的请求保守计入次数。Redis 重启后从审计中的已发送记录恢复配额；恢复失败时暂停 AI，而不是把每日限额重置为可无限调用。

次数和最大输出 tokens 用于约束开销；Token 统计不是 DeepSeek 账户余额或最终账单。价格会变，不在业务里硬编码一个长期准确的人民币费用。

### 8.3 幂等与调用顺序

1. 验证身份、功能开关、输入和请求 ID。
2. 短事务建立唯一请求记录；相同 ID 不同输入返回 409，相同输入已有结果则复用。
3. 预留额度和取得并发名额，再进行模型请求。
4. 返回内容转换成模型 DTO，再进行应用规则校验；生成结果缓存并更新审计元数据。
5. 原请求仍运行时返回“处理中”，不能再发送一次；终态缓存过期后返回已过期状态，需要用户主动创建新请求。
6. 超时、取消或进程异常产生结果不确定状态时，不由客户端自动重发模型请求；重放同一 ID 只能查询/复用状态。

如果模型成功但审计或缓存写入失败，需要保留不确定状态并阻止自动再生成；可以暂时降级为手动输入。AI 可用性不能以破坏原有日历可靠性为代价。

## 9. 超时、故障与安全边界

- 第一版使用同步 ChatClient 请求和非阻塞获取的并发名额；最多占用一个接口工作线程，不复用日记索引线程池。
- 建议连接超时 3 秒、单次模型 HTTP 调用上限 25 秒、客户端/代理总上限略大于调用上限，例如 35 秒；实际实现同时限制连接、读取和响应体大小。
- 默认不自动重试，显式覆盖 Spring AI 重试配置。模型已经处理但网络超时可能仍计费；不能只套 `CompletableFuture.orTimeout` 就认为底层请求已经终止。
- 并发名额在底层调用结束或实际取消后释放；若后续增加专用线程池，应独立命名、有界排队、拒绝策略和停机处理。
- HTTP 401 表示应用登录失效，429 表示本应用限额或繁忙；上游密钥错误、上游限额、错误响应等转换成稳定的 AI 错误码和可读提示，不泄露上游原文或密钥。
- 模型输入仅包含用户此次主动提交的文字、日期和默认分类；界面明确提示该文字会发送给 DeepSeek。第一期不上传全量日历、日记、账号列表、令牌或共享数据。
- 用户输入作为独立 user 消息，不能覆盖系统提示、模型配置或权限。模型输出按数据处理，不执行其中的 SQL、脚本、HTML 或任意工具请求。
- 日志记录 requestId、状态、耗时、用量和错误类型；不记录提示词中的私人原文、Authorization、响应正文和推理过程。

## 10. 第二期与后续学习路线

RAG 业务扩展的具体建议见 [个人记录问答与 RAG 设计](rag-business-design.md)，从带来源的日记问答开始，逐步增加语义检索和参考历史的预排建议。

| 阶段 | 功能 | 可以学习的内容 |
| --- | --- | --- |
| 基础升级 | Boot 4 / Cloud / MyBatis 升级 | BOM、自动配置、Jackson 迁移、兼容性回归 |
| AI 最小链路 | 一句话生成计划草稿 | ChatClient、系统提示词、模型参数、JSON DTO |
| 完整产品链路 | 编辑确认、批量保存、幂等和预算 | 业务校验、鉴权、Redis、MyBatis、故障处理 |
| 时间预排 | 从最终目标生成步骤和建议耗时 | 多层结构化输出、建议与确定计算的分工 |
| 只读工具 | 查询指定日期已有时间线 | Tool Calling、账号上下文与工具授权 |
| 可选知识检索 | 基于本人历史信息做建议 | RAG、检索授权、评估；另行选用适合的 embedding 模型 |

时间预排阶段：AI 建议步骤和耗时，用户确认；实际倒推、跨天和起止时间由现有确定性算法计算。继续保留“只把最终目标发布为计划”的规则。

只读工具阶段：服务端绑定当前账号，限制日期范围和返回数量，模型不能通过参数选择其他账号。第一期不注册写入、删除或分享工具。已有 ES 关键词索引不等于向量库，接入 DeepSeek 聊天模型也不代表已获得 embedding 能力。

## 11. 验收与发布

### 11.1 自动化验证

- 基础升级：现有 Java 测试、59 组同步样例、前端类型检查及相关测试，检查旧客户端协议和 Node 互通。
- 模型调用使用模拟 HTTP 服务，检查模型名、非思考参数、JSON 模式、输出上限、超时、禁用开关及密钥不泄露；持续集成不默认使用真实模型。
- 日期覆盖：明天、跨月/年、闰日、选中日期与当前日期不同、下周、模糊时间和跨午夜重试。
- 输出覆盖：合法草稿、多事件、空白、非 JSON、截断、错误枚举、非法日期、超量事件和过长文本。
- 保存覆盖：双击、重复返回、已有 ID、切换账号、关闭面板、批量非法条目、Electron 原子落盘及离线后同步。
- 权限覆盖：正式/Cloud 两种身份路径、伪造账号、过期或错误用途的内部凭据、篡改请求体和跨账号重放。
- 用量覆盖：并发竞争、UTC/北京时间切日、Redis 重启、额度预留、超时未知、进程崩溃及幂等缓存过期。
- 功能关闭、DeepSeek 不可用、Cloud 停止时，手动录入和既有同步仍通过。

增加一组人工标注的中文事件样本，分别评估事项拆分、日期、分类、歧义提示和确认后的计划文本。先建立基线再调整提示词，不能只看几个成功演示就判断准确率。

真实模型测试必须显式开启，使用无私人内容的小样本，记录模型、提示词版本、耗时和 tokens；本设计阶段没有执行。

### 11.2 发布顺序

1. 保留当前可运行代码、构建产物和配置，建立升级前验证基线。
2. 完成 Boot 4 全套兼容升级，先以 AI 关闭模式验证原功能。
3. 完成本地 Spring AI 协议与业务测试，再进行少量真实 DeepSeek 调用。
4. 测试环境运行 MySQL、Redis、Nacos、ES 与全套 Cloud 服务，验证 Node/Java 数据互通。
5. 部署前创建一致性数据库备份、配置和旧镜像备份；只增加独立审计表。
6. Cloud 入口按账号白名单启用 AI；观察模型正确率、失败率、延迟、调用次数及容器内存。
7. 增加 Node 内部桥接，验证正式网页可用，再打包安装客户端；客户端能力探测失败时不显示可调用的 AI 入口。
8. 达标后扩大到现有用户，保留关闭开关与旧业务版本。

服务器仍需按 2GB 的资源条件做实际压力和内存观察。远程模型不在本机推理，但 Boot 4、Spring AI、连接与 JSON 处理仍有内存开销，不能因用户少就保证容量够用。保留原内存保护，不为了 AI 停止共用 MySQL。

回退优先关闭 AI 开关；必要时回退 Java JAR/镜像和前端入口。原数据表不迁移，新增审计表可保留，不从旧快照覆盖期间产生的日历或日记数据。

## 12. 本期最终交付定义

完成 Boot 4 + Spring AI 2.0 的兼容升级；网页和客户端可主动调用 DeepSeek 将一句或多句自然语言转换为计划草稿，用户编辑确认后批量保存，随后沿用原同步。具备日期歧义提示、账号隔离、幂等、并发限制、额度、元数据审计和故障降级。

自动写入代理、全量私人上下文、长期记忆、向量检索、普通计划结构化时间字段及系统提醒自动配置，都属于后续独立迭代。
