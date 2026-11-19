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
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/** 模型调用不持有数据库事务；唯一请求、用量和缓存共同限制重复付费。 */
@Service
public class AiRequestService {

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

    /** 只有显式启用且存在密钥时，允许实际 AI 功能。 */
    public boolean enabled() {
        return settings.enabled() && settings.apiKey() != null && !settings.apiKey().isBlank();
    }

    /** 先取得持久化请求身份再调用上游；未知状态不自动再次发起模型请求。 */
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
            if (
                !UUID.fromString(request).toString().equals(request)
            ) throw new IllegalArgumentException();
        } catch (Exception invalid) {
            throw new ApiException(400, "AI 请求标识无效");
        }
        String fingerprint = fingerprint(feature + ":v1:" + settings.model() + ":" + body);
        if (
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
            AiRequestEntity old = audit.find(account, request);
            if (old == null || !fingerprint.equals(old.fingerprint())) throw new ApiException(
                409,
                "请求标识已用于其他内容，请重新生成"
            );
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
            lease = quota.acquire();
            quota.reserve(
                account,
                Math.max(1, settings.accountDailyLimit()),
                Math.max(1, settings.globalDailyLimit())
            );
            Result<T> result = operation.get();
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
            throw new ApiException(503, "AI 暂不可用，原文已保留，可继续手动操作");
        } finally {
            if (lease != null) try {
                quota.release(lease);
            } catch (RuntimeException ignored) {
                /* 租约自动过期，不覆盖业务返回。 */
            }
        }
    }

    /** 指纹使用服务端密钥 HMAC，既区分内容又避免原文进入日志与审计。 */
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
