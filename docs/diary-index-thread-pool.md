# 日记索引自定义线程池

Java Cloud 版本现在由 `IndexExecutorConfig` 手动创建 `ThreadPoolExecutor`，交给 Spring 管理生命周期。IDEA 中从 `diaryIndexExecutor()` 开始阅读，再看 `IndexWorker.tick()` 和 `processOne()`。

## 用在什么地方

保存日记时，原有事务把日记和 outbox 待办一起写入 MySQL。每隔 3 秒，调度器向专用线程池提交最多两个批次；每个批次最多处理 5 条到期待办。ES 更新成功后删除待办，搜索索引因此是最终一致的，保存后不一定立刻搜到最新内容。

每条待办都在工作线程内通过 `TransactionTemplate` 开启独立事务，使用 `FOR UPDATE SKIP LOCKED` 认领。数据库行锁协调两个 Java 工作线程以及使用相同 outbox 的 Node 后端。不会把一个事务或 JDBC 连接交给多个线程使用。

## 参数为什么这样设置

| 参数 | 当前值 | 含义 |
|---|---|---|
| corePoolSize / maximumPoolSize | 2 / 2 | 最多两个索引工作线程，给接口访问保留数据库连接余量 |
| workQueue | ArrayBlockingQueue，容量 2 | 限制内存中的等待批次 |
| keepAliveTime | 30 秒 | 开启核心线程超时，空闲后允许回收线程 |
| threadFactory | diary-index-1 等 | 排查线程栈时能识别业务用途 |
| rejectionHandler | AbortPolicy | 拒绝超量批次，数据库任务留到下轮，不占用调度线程执行索引 |

`Semaphore` 进一步限制运行中和等待中的批次总数最多两个，避免慢 ES 请求遇到多次定时触发时积压批次。队列是线程池的最后一道容量保护，真正的业务待办始终保存在数据库中。

## 失败和关闭

- ES 更新失败：增加尝试次数，按原规则退避 2、4、8……秒，最多 60 秒，再次处理。
- 数据库认领失败：事务回滚，释放批次名额，等后续调度重试。
- 线程池拒绝：释放提交名额，不取走数据库待办。
- 正常关闭：停止提交和认领新任务，最多等待 15 秒让当前任务提交；随后中断工作线程，再等 5 秒。关闭过程本身被中断时立即中断工作线程。
- 索引调用因线程中断而失败时，回滚当前事务，避免删除尚未完成的待办。ES 若已经写入，重试仍受原有版本校验保护。

这次不改变接口、数据库结构、网页或客户端。Node 后端的定时索引逻辑不受影响；仅构建或修改本地 Java 代码不会更新服务器，部署新的 diary-service 后才会生效。两个线程的设置是针对当前小规模使用的保守选择，仍需结合实际数据库连接等待和服务器内存观察运行效果。

## 验证范围

`IndexWorkerTest` 使用真实线程池、Spring 事务同步上下文和模拟数据库/ES，覆盖并发上限、事务线程绑定、重复触发、失败重试、认领异常回滚、拒绝恢复和关闭。它不替代真实 MySQL/ES 集成测试。

参考：[Java 17 ThreadPoolExecutor](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html)、[Spring 编程式事务](https://docs.spring.io/spring-framework/reference/data-access/transaction/programmatic.html)。
