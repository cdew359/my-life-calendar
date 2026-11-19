package cn.imlaomi.cloud.calendar.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** 只在后端使用模型配置，密钥不得进入响应、日志或前端配置。 */
@ConfigurationProperties("cloud.ai")
public record AiProperties(
    @DefaultValue("false") boolean enabled,
    @DefaultValue("deepseek-flash") String model,
    @DefaultValue("") String apiKey,
    @DefaultValue("https://api.deepseek.com") String baseUrl,
    @DefaultValue("") String bridgeSecret,
    @DefaultValue("20") int accountDailyLimit,
    @DefaultValue("50") int globalDailyLimit
) {
    /** 避免配置对象的默认日志输出包含密钥。 */
    @Override
    public String toString() {
        return "AiProperties[secrets redacted]";
    }
}
