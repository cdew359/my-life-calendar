package cn.imlaomi.cloud.user.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.stereotype.Component;

/** Non-secret operational policy refreshed from Nacos; credentials stay in the environment. */
@Component
@RefreshScope
public class LoginPolicy {

    private final int maxAttempts;

    /** 将配置中心提供的登录尝试上限限制在 1 到 20 之间，防止误配置关闭限流。 */
    public LoginPolicy(@Value("${cloud.login-max-attempts:5}") int maxAttempts) {
        this.maxAttempts = Math.max(1, Math.min(20, maxAttempts));
    }

    /** 返回当前配置实例生效的每分钟尝试上限。 */
    public int maxAttempts() {
        return maxAttempts;
    }
}
