# Nginx 入口与 Spring Cloud 业务服务

小内存部署使用现有 Nginx 承担公开 API 路由，保留 user-service、calendar-service、diary-service 三个独立 Java 进程，以及 Nacos、Redis、MySQL 和 Elasticsearch。Java Gateway 保留源码，作为可选部署模块，不随这个模式启动。

## 请求路径

| 公开路径                                                                      | 目标服务         |
| ----------------------------------------------------------------------------- | ---------------- |
| `/api/login`、`/api/register`、`/api/accounts`、`/api/profile`、`/api/health` | user-service     |
| `/api/data`、三个已声明的 `/api/ai/...` 接口                                  | calendar-service |
| `/api/diaries/...`                                                            | diary-service    |

`/api/health` 由用户服务提供，保留既有客户端需要的同步能力和数据模式字段。现有 `/cloud-api/api/...` 兼容入口可重写到同一套路由，前端和客户端无需改同步协议。

Nginx 直接使用 Docker 私网 DNS 寻址；业务服务之间的 Feign 调用继续使用 Nacos。内部接口与 Actuator 不作为公开路由发布。普通 API 读取超时为 15 秒，AI 为 45 秒；跨域允许 Authorization 与 Content-Type。转发时覆盖来源 IP 并移除客户端提交的 X-Account-Id，身份仍由各服务验证。

## 配置与会话兼容

`cloud/deploy/nginx-cloud-map.conf` 是公开路由白名单，`nginx-cloud-proxy.inc` 是 location 内的公共转发配置。部署时要为 AI 单独设置读取超时，并让 Nginx 接入 Cloud 私网。`compose.nginx.yml` 为可选 Compose 覆盖文件；现场的网络名、目录、证书和镜像标签仍需按真实环境配置。

已验证的完整配置模板为 `server/deploy/domain/https-cloud.conf` 和 `server/deploy/nginx-web-cloud.conf`。两者都包含映射规则，分别用于 HTTPS 边缘入口和原网页端口。Node 的历史模板仍保留，不能在 Cloud 正式运行时覆盖新的路由。AI 容器总内存上限为 320MiB，JVM 堆上限保持原设置；总容器内存与 Java 堆不是同一个概念。

Node 与 Java 原有令牌格式兼容，但签名密钥可能不同。迁移时统一 TOKEN_SECRET 为原正式入口的密钥，必要时通过私有环境变量 LEGACY_TOKEN_SECRET 兼容旧 Cloud 会话。三个业务服务都必须读取这两个配置。新令牌只使用统一密钥签发；旧密钥仅校验迁移前尚未过期的令牌，原过期校验保持不变。旧会话全部到期后，可移除旧密钥并重建服务。密钥不进入仓库和前端。

## 发布与回退

先备份数据库、配置和镜像，确认三项业务服务共享现有 MySQL 和 ES。启动 Nacos、Redis 和业务服务，通过原正式令牌与旧 Cloud 令牌检查真实账号的只读返回，再切换 Nginx。用隔离测试账号验证写入、搜索和 AI，验证结束后清理测试数据，不写入真实用户的数据。

通过后停止 Node、Java Gateway 和无依赖的旧 PostgreSQL，保留镜像与数据卷。内存保护应排除有意停用的 Gateway，不再把整个 Cloud 当作可随意停止的试验栈。生产保护使用原压力阈值，在持续故障时先恢复保留的 Node 入口与路由，再停止 Cloud 业务服务；回退不恢复旧 SQL，不覆盖切换期间的新业务数据。

小内存参数与一次验证不构成长期容量保证。保留压力监测并以实际运行结果评估。

原试验栈的启动和保护脚本仍保留供独立试验环境使用。正式切换后，不应运行这些脚本覆盖现场的生产保护与回退配置。
