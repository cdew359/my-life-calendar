package cn.imlaomi.cloud.common;

import static org.assertj.core.api.Assertions.*;

import cn.imlaomi.cloud.common.config.ApiSecurity;
import cn.imlaomi.cloud.common.config.BodyLimit;
import cn.imlaomi.cloud.common.exception.ApiErrors;
import cn.imlaomi.cloud.common.security.AccountResolver;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import tools.jackson.databind.ObjectMapper;

class CommonContextTest {

    /** 验证公共过滤器能够启动，且不会因 Bean 名称冲突导致启动失败。 */
    @Test
    void startsFiltersWithoutBeanNameCollisions() {
        new WebApplicationContextRunner()
            .withUserConfiguration(BodyLimit.class, ApiSecurity.class, ApiErrors.class)
            .withPropertyValues("cloud.token-secret=test-only-secret-at-least-32-characters")
            .withBean(ObjectMapper.class, tools.jackson.databind.json.JsonMapper.builder()::build)
            .withBean(AccountResolver.class, () -> id -> true)
            .run(context ->
                assertThat(context)
                    .hasNotFailed()
                    .hasBean("boundedRequestFilter")
                    .hasBean("accountFilter")
            );
    }
}
