# 公开仓库维护

首次整理只提交可复现的源码、锁文件、测试、公开配置模板与虚构截图。原本的个人部署记录和历史截图仍在本机，但被忽略；没有删除私人资料，也不上传旧项目“照见”的历史。

## 提交前

```sh
git status --short
npm run public:check
git add .
npm run public:check -- --staged
git diff --cached --stat
```

检查器只输出文件位置和规则名，不输出匹配到的密钥正文。覆盖已知提供商密钥、私钥、JWT、带密码连接串和可疑凭据字面量；它不能保证识别所有秘密。新增截图需人工检查真实姓名、账号与日记内容。

`.gitignore` 排除依赖、产物、运行数据、快照、日志、真实环境文件和本地令牌；保留空值 `.env.example`、锁文件及合成测试数据。`.dockerignore` 避免 Node 构建上下文夹带运行资料。不要用 `git add -f` 绕过这些规则。

公开文档只描述可复现行为和已验证范围。AI 模拟协议测试不写成真实模型调用；少量用户的个人部署不写成高并发生产成果；持续集成是否成功以 Actions 实际记录为准。

## 更新项目

```sh
git add .
npm run public:check -- --staged
git commit -m "说明这次变更的具体行为"
git push
```

安装包通过下载渠道或 Releases 分发，不把整个 `release/` 提交到源码。生产配置和数据库数据继续由私有备份流程维护。提交作者使用 GitHub 隐私邮箱，仓库不必暴露个人邮件。

## 简历表述示例

**My Life Calendar｜个人日历与日记助手**  
源码：`https://github.com/cdew359/my-life-calendar`  
技术：Java 17、Spring Boot、Spring Cloud、Nacos、MyBatis、MySQL、Redis、Elasticsearch、Spring AI。

- 设计账号隔离的计划与日记业务，支持网页、Electron 和 Java/Node 兼容入口；实现多端合并、删除墓碑、日记版本冲突校验。
- 采用事务 outbox 与有界线程池异步维护 ES 索引，通过任务认领、失败重试和版本回查处理最终一致性。
- 基于 Spring AI 实现可编辑计划草稿与带出处的日记全文 RAG，加入输入校验、用户确认、请求幂等和调用配额；真实模型联调尚待完成。

按自己实际掌握的部分调整，不直接照抄无法解释的技术点。当前未选择许可证；发布源码不等于已经为项目添加了 MIT 等许可证。
