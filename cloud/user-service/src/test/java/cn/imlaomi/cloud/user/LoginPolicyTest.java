package cn.imlaomi.cloud.user;

import static org.assertj.core.api.Assertions.assertThat;

import cn.imlaomi.cloud.user.config.LoginPolicy;
import org.junit.jupiter.api.Test;

class LoginPolicyTest {

    /** 验证非法配置不能关闭登录限流或把上限提升到允许范围之外。 */
    @Test
    void configurationCannotDisableOrUnboundLoginThrottling() {
        assertThat(new LoginPolicy(0).maxAttempts()).isEqualTo(1);
        assertThat(new LoginPolicy(5).maxAttempts()).isEqualTo(5);
        assertThat(new LoginPolicy(1000).maxAttempts()).isEqualTo(20);
    }
}
