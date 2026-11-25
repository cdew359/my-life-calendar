package cn.imlaomi.cloud.gateway;

import static org.assertj.core.api.Assertions.*;

import java.net.*;
import java.net.http.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.cloud.gateway.route.RouteLocator;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = { "spring.config.location=classpath:/gateway-test.yml" }
)
class GatewayStartupTest {

    @LocalServerPort
    int port;

    @Autowired
    RouteLocator routes;

    /** 验证网关能够启动，只公开已声明的业务路由且不暴露内部接口。 */
    @Test
    void startsAndOnlyExposesExplicitApiRoutes() throws Exception {
        assertThat(
            routes
                .getRoutes()
                .map(r -> r.getId())
                .collectList()
                .block()
        ).containsExactlyInAnyOrder("users", "calendar", "ai", "diaries");
        var ai = routes
            .getRoutes()
            .filter(r -> r.getId().equals("ai"))
            .blockFirst();
        assertThat(ai.getMetadata()).containsEntry("response-timeout", 35000);
        var calendar = routes
            .getRoutes()
            .filter(r -> r.getId().equals("calendar"))
            .blockFirst();
        assertThat(calendar.getMetadata()).doesNotContainKey("response-timeout");
        var http = HttpClient.newHttpClient();
        var health = http.send(
            HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/health")).build(),
            HttpResponse.BodyHandlers.ofString()
        );
        assertThat(health.statusCode()).isEqualTo(200);
        assertThat(health.body()).contains("spring-cloud-trial");
        assertThat(health.body()).contains("birthday-reminders-v1");
        var internal = http.send(
            HttpRequest.newBuilder(
                URI.create("http://127.0.0.1:" + port + "/internal/accounts")
            ).build(),
            HttpResponse.BodyHandlers.ofString()
        );
        assertThat(internal.statusCode()).isEqualTo(404);
    }
}
