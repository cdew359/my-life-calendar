package cn.imlaomi.cloud.calendar.service;

import cn.imlaomi.cloud.calendar.client.AiModelClient.Result;
import cn.imlaomi.cloud.calendar.config.AiProperties;
import cn.imlaomi.cloud.calendar.dao.*;
import cn.imlaomi.cloud.calendar.entity.AiRequestEntity;
import cn.imlaomi.cloud.common.exception.ApiException;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.UUID;
import java.util.function.Supplier;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * 计划提取和日记问答共用的请求治理层，不直接理解具体提示词或调用 DeepSeek。
 *
 * <p>MySQL 保存唯一请求及终态，Redis 保存并发租约、每日配额和短期结果。
 * 通过 Supplier 延迟执行具体业务，命中成功缓存或请求被拒绝时不执行该动作。
 * 不用长事务包住网络请求；即使上游超时，也保留持久化身份以阻止同请求自动重付费。
 */
@Service
public class AiRequestService {

    private static final Logger log = LoggerFactory.getLogger(AiRequestService.class);

    private final AiProperties settings;
    private final AiRequestDao audit;
    private final AiQuotaDao quota;
    private final ObjectMapper json;

    /** 注入持久化幂等、配额和序列化边界。 */
    public AiRequestService(
        AiProperties settings,
        AiRequestDao audit,
        AiQuotaDao quota,
        ObjectMapper json
    ) {
        this.settings = settings;
        this.audit = audit;
        this.quota = quota;
        this.json = json;
    }

    /**
     * 判断服务配置是否允许调用 AI，不发送模型请求，也不验证依赖实时健康。
     *
     * @return 总开关开启且后端 API key 非空时为 true，不代表提供商已接受该 key
     */
    public boolean enabled() {
        return settings.enabled() && settings.apiKey() != null && !settings.apiKey().isBlank();
    }

    /**
     * 在幂等、并发和次数控制之内执行一次 AI 业务，并缓存结构化结果、记录审计。
     *
     * <p>同账号同 UUID 只认领一次；指纹不同返回 409。原请求成功且缓存仍在时直接返回，
     * 成功但缓存过期返回 410，失败或处理中等其他状态返回 409，不自动再次执行 Supplier。
     * 新请求先取得租约、预留配额，再执行业务，最后缓存结果并标记成功。
     *
     * <p>失败写入 FAILED；若审计也失败则可能保留 PROCESSING。两者均不会由本方法自动重试。
     * 次数是保守的请求计数，失败和无证据也可能计入，不等于提供商真实账单。
     *
     * @param account 鉴权所得账号，也是数据库唯一键及缓存键的一部分
     * @param request 本次客户端请求的规范 UUID 字符串
     * @param feature 业务类别，当前为 events 或 knowledge
     * @param body 用于指纹的序列化请求，不作为明文写入审计
     * @param type 缓存重放时使用的明确响应 DTO 类型
     * @param operation 只有新请求通过治理后才执行的业务动作，返回 DTO 和用量
     * @param <T> 对外业务响应类型
     * @return 新生成或从当前账号短期缓存恢复的结果
     * @throws ApiException 开关关闭、标识无效、幂等冲突、配额不足或业务失败
     */
    public <T> T execute(
        String account,
        String request,
        String feature,
        String body,
        Class<T> type,
        Supplier<Result<T>> operation
    ) {
        if (!enabled()) throw new ApiException(503, "AI 尚未启用，可继续手动录入和搜索");
        try {
            //校验request是否为标准的uuid格式
            if (
                !UUID.fromString(request).toString().equals(request)
            ) throw new IllegalArgumentException();
        } catch (Exception invalid) {
            throw new ApiException(400, "AI 请求标识无效");
        }
        // 将业务版本与模型纳入内容身份；不把原文直接落入审计或用普通哈希暴露可枚举文本。  events:v1:deepseek-flash:{"text":"明天开会",其他字段...}
        String fingerprint = fingerprint(feature + ":v1:" + settings.model() + ":" + body);
        if (
            //依靠 (account_id, request_id) 唯一键，让同账号的同一个请求只能被认领一次。
            audit.claim(
                new AiRequestEntity(
                    account,
                    request,
                    fingerprint,
                    feature,
                    settings.model(),
                    "PROCESSING",
                    System.currentTimeMillis()
                )
            ) == 0
        ) {
            // INSERT 未认领成功时，只读取同账号的原请求，绝不凭 UUID 跨账号复用。
            AiRequestEntity old = audit.find(account, request);
            if (old == null || !fingerprint.equals(old.fingerprint())) throw new ApiException(
                409,
                "请求标识已用于其他内容，请重新生成"
            );
            //如果拿到的数据已经是成功的了，则从缓存中获取，如果不在缓存中就标记过期
            if ("SUCCEEDED".equals(old.status())) {
                String cached = quota.cached(account, request);
                if (cached != null) return json.readValue(cached, type);
                throw new ApiException(410, "结果已过期，请主动重新生成");
            }
            throw new ApiException(409, "该请求已处理或结果未知，请勿自动重试；需要时主动重新生成");
        }
        String lease = null;
        long started = System.currentTimeMillis();
        try {
            // 并发租约跨服务实例共享；获取失败时不会进入实际模型业务。当前全站只有一个名额。
            lease = quota.acquire();
            quota.reserve(
                account,
                Math.max(1, settings.accountDailyLimit()),
                Math.max(1, settings.globalDailyLimit())
            );
            // 只有这里执行调用方的流程；RAG 无证据时，该流程也可以不调用模型而返回提示。
            Result<T> result = operation.get();
            // 先缓存正文、再写成功终态；任一步骤失败都不自动重做可能已付费的网络请求。
            quota.cache(account, request, json.writeValueAsString(result.value()));
            audit.finish(
                account,
                request,
                "SUCCEEDED",
                result.inputTokens(),
                result.outputTokens(),
                System.currentTimeMillis() - started,
                System.currentTimeMillis()
            );
            return result.value();
        } catch (RuntimeException failure) {
            try {
                audit.finish(
                    account,
                    request,
                    "FAILED",
                    null,
                    null,
                    System.currentTimeMillis() - started,
                    System.currentTimeMillis()
                );
            } catch (RuntimeException ignored) {
                /* 保留 PROCESSING，防止未知请求自动重新计费。 */
            }
            if (failure instanceof ApiException expected) throw expected;
            // 只记录异常类型，不记录上游消息、请求正文、账号、密钥或原始响应。
            log.warn(
                "AI request failed: feature={}, type={}, causeType={}",
                feature,
                failure.getClass().getSimpleName(),
                failure.getCause() == null ? "none" : failure.getCause().getClass().getSimpleName()
            );
            throw new ApiException(503, "AI 暂不可用，原文已保留，可继续手动操作");
        } finally {
            if (lease != null) try {
                quota.release(lease);
            } catch (RuntimeException ignored) {
                /* 租约自动过期，不覆盖业务返回。 */
            }
        }
    }

    /**
     * 计算请求内容的 HMAC-SHA256 指纹，仅用于内容身份比较，不代替登录鉴权。
     * 当前使用后端模型密钥参与计算，轮换密钥可能使旧请求重放产生指纹冲突；
     * 此时应由用户主动新建请求，而不是绕过原有幂等身份。
     */
    private String fingerprint(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(
                new SecretKeySpec(settings.apiKey().getBytes(StandardCharsets.UTF_8), "HmacSHA256")
            );
            return HexFormat.of().formatHex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception failure) {
            throw new ApiException(503, "AI 配置不可用");
        }
    }
}
