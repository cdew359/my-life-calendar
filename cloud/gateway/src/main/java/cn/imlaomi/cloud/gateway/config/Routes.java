package cn.imlaomi.cloud.gateway.config;

import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.route.*;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.*;

@Configuration
public class Routes {

    /** 为账号、日历、AI 和日记 API 注册按服务名转发的网关路由。 */
    @Bean
    RouteLocator gatewayRoutes(RouteLocatorBuilder builder) {
        return builder
            .routes()
            .route("users", r ->
                r
                    .path("/api/login", "/api/register", "/api/accounts", "/api/profile")
                    .filters(f -> f.removeRequestHeader("X-Account-Id"))
                    .uri("lb://user-service")
            )
            .route("calendar", r ->
                r
                    .path("/api/data")
                    .filters(f -> f.removeRequestHeader("X-Account-Id"))
                    .uri("lb://calendar-service")
            )
            .route("ai", r ->
                r
                    .path(
                        "/api/ai/capabilities",
                        "/api/ai/events/interpret",
                        "/api/ai/knowledge/ask"
                    )
                    .filters(f -> f.removeRequestHeader("X-Account-Id"))
                    // 模型读取可持续25秒；仅 AI 路由延长到35秒，普通同步仍沿用15秒。
                    .metadata("response-timeout", 35000)
                    .uri("lb://calendar-service")
            )
            .route("diaries", r ->
                r
                    .path("/api/diaries/**")
                    .filters(f -> f.removeRequestHeader("X-Account-Id"))
                    .uri("lb://diary-service")
            )
            .build();
    }

    /** 为公开 API 设置跨域来源、请求方法和允许的请求头。 */
    @Bean
    CorsWebFilter cors() {
        CorsConfiguration c = new CorsConfiguration();
        c.setAllowedOrigins(List.of("*"));
        c.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        c.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        c.setMaxAge(600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", c);
        return new CorsWebFilter(source);
    }
}
