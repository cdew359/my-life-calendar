package cn.imlaomi.cloud.common.config;

import cn.imlaomi.cloud.common.dto.ApiErrorResponse;
import cn.imlaomi.cloud.common.security.AccountResolver;
import cn.imlaomi.cloud.common.util.Tokens;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.*;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

@Configuration
public class ApiSecurity {

    public static final String ACCOUNT = "calendar.account";

    /** 使用服务器私有签名密钥创建兼容原协议的令牌工具。 */
    @Bean
    Tokens tokens(@Value("${cloud.token-secret}") String secret) {
        return new Tokens(secret);
    }

    /** 为受保护的 API 校验令牌与账号存在性，并将账号标识写入请求上下文。 */
    @Bean
    FilterRegistrationBean<OncePerRequestFilter> accountFilter(
        Tokens tokens,
        AccountResolver resolver,
        ObjectMapper json
    ) {
        var bean = new FilterRegistrationBean<OncePerRequestFilter>();
        bean.setFilter(
            new OncePerRequestFilter() {
                /** 放行公开接口和预检请求，为其他 API 校验签名令牌与账号，并设置当前账号上下文。 */
                @Override
                protected void doFilterInternal(
                    HttpServletRequest request,
                    HttpServletResponse response,
                    FilterChain chain
                ) throws ServletException, IOException {
                    String path = request.getRequestURI();
                    if (
                        !path.startsWith("/api/") ||
                        Set.of("/api/login", "/api/register", "/api/health").contains(path) ||
                        "OPTIONS".equals(request.getMethod())
                    ) {
                        chain.doFilter(request, response);
                        return;
                    }
                    String header = Optional.ofNullable(request.getHeader("Authorization")).orElse(
                        ""
                    );
                    String account = header.startsWith("Bearer ")
                        ? tokens.verify(header.substring(7))
                        : null;
                    boolean found = false;
                    try {
                        if (account != null) found = resolver.exists(account);
                    } catch (Exception e) {
                        response.setStatus(503);
                        response.setContentType("application/json;charset=UTF-8");
                        json.writeValue(
                            response.getOutputStream(),
                            new ApiErrorResponse("账号服务暂时不可用")
                        );
                        return;
                    }
                    if (!found) {
                        response.setStatus(401);
                        response.setContentType("application/json;charset=UTF-8");
                        json.writeValue(
                            response.getOutputStream(),
                            new ApiErrorResponse("未登录或登录已过期")
                        );
                        return;
                    }
                    request.setAttribute(ACCOUNT, account);
                    chain.doFilter(request, response);
                }
            }
        );
        bean.setOrder(1);
        return bean;
    }
}
