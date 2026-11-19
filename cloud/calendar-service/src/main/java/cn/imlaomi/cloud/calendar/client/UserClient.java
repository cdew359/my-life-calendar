package cn.imlaomi.cloud.calendar.client;

import cn.imlaomi.cloud.common.dto.AccountExistsResponse;
import cn.imlaomi.cloud.common.dto.AccountSummary;
import cn.imlaomi.cloud.common.security.AccountResolver;
import feign.RequestInterceptor;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.context.annotation.*;
import org.springframework.web.bind.annotation.*;

@FeignClient(name = "user-service", configuration = UserClient.Internal.class)
public interface UserClient {
    /** 调用用户服务的内部接口，取得分享分发所需的账号列表。 */
    @GetMapping("/internal/accounts")
    List<AccountSummary> accounts();

    /** 调用用户服务判断指定账号是否仍然存在。 */
    @GetMapping("/internal/accounts/{id}")
    AccountExistsResponse exists(@PathVariable("id") String id);

    class Internal {

        /** 为 Feign 内部调用附加服务间鉴权密钥。 */
        @Bean
        RequestInterceptor internalHeader(@Value("${cloud.internal-key}") String key) {
            return template -> template.header("X-Internal-Key", key);
        }
    }

    @Configuration
    class Security {

        /** 将用户服务的账号存在性查询适配为鉴权过滤器使用的接口。 */
        @Bean
        AccountResolver remoteAccounts(UserClient client) {
            return id -> client.exists(id).exists();
        }
    }
}
