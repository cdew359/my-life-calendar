package cn.imlaomi.cloud.user.config;

import cn.imlaomi.cloud.common.security.AccountResolver;
import cn.imlaomi.cloud.user.service.UserService;
import org.springframework.context.annotation.*;

/** 本服务鉴权使用本地业务查询，避免依赖远程调用。 */
@Configuration
public class AccountSecurityConfig {

    /** 注册鉴权所需的账号查询策略。 */
    @Bean
    AccountResolver localAccounts(UserService service) {
        return service::existsAccount;
    }
}
