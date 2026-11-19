package cn.imlaomi.cloud.calendar;

import static org.assertj.core.api.Assertions.*;

import cn.imlaomi.cloud.calendar.dao.AiRequestDao;
import cn.imlaomi.cloud.calendar.entity.AiRequestEntity;
import java.net.*;
import java.net.http.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = { "spring.config.location=classpath:/calendar-test.yml" }
)
class CalendarStartupTest {

    @LocalServerPort
    int port;

    @Autowired
    AiRequestDao audit;

    @Autowired
    JdbcTemplate db;

    /** 验证完整 Boot 4 上下文、AI 关闭时无密钥启动、内部签名和真实 MyBatis 审计 SQL。 */
    @Test
    void startsWithoutKeyAndPersistsIsolatedAudit() throws Exception {
        var http = HttpClient.newHttpClient();
        var response = http.send(
            HttpRequest.newBuilder(
                URI.create("http://127.0.0.1:" + port + "/internal/ai/events/interpret")
            )
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{}"))
                .build(),
            HttpResponse.BodyHandlers.ofString()
        );
        assertThat(response.statusCode()).isEqualTo(403);
        db.execute(
            "CREATE TABLE cloud_ai_requests(account_id VARCHAR(48),request_id VARCHAR(36),fingerprint CHAR(64),feature VARCHAR(24),model VARCHAR(100),status VARCHAR(24),input_tokens INT,output_tokens INT,latency_ms BIGINT,created_at BIGINT,finished_at BIGINT,PRIMARY KEY(account_id,request_id))"
        );
        var row = new AiRequestEntity(
            "alice",
            "request",
            "fingerprint",
            "events",
            "test",
            "PROCESSING",
            100L
        );
        assertThat(audit.claim(row)).isEqualTo(1);
        assertThat(audit.claim(row)).isZero();
        assertThat(audit.find("bob", "request")).isNull();
        assertThat(audit.find("alice", "request")).isEqualTo(row);
        assertThat(audit.finish("alice", "request", "SUCCEEDED", null, 7, 12, 200)).isEqualTo(1);
        assertThat(audit.find("alice", "request").status()).isEqualTo("SUCCEEDED");
        assertThat(audit.countSince(null, 0)).isEqualTo(1);
        assertThat(audit.countSince("bob", 0)).isZero();
        assertThat(audit.deleteExpired(150)).isEqualTo(1);
    }
}
