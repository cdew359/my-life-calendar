package cn.imlaomi.cloud.calendar.config;

import static org.assertj.core.api.Assertions.*;

import cn.imlaomi.cloud.calendar.client.DeepSeekEventAiClient;
import cn.imlaomi.cloud.calendar.dto.AiDtos.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.document.Document;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import tools.jackson.databind.json.JsonMapper;

class DeepSeekProtocolTest {

    /** 关闭 AI 时不创建模型客户端，也不需要任何模型密钥。 */
    @Test
    void disabledConfigurationNeedsNoApiKey() {
        new ApplicationContextRunner()
            .withUserConfiguration(AiConfig.class)
            .withPropertyValues("cloud.ai.enabled=false")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(context).doesNotHaveBean(ChatClient.class);
            });
    }

    /** 对真实 Spring AI HTTP 协议进行模拟，验证结构化、RAG、用量和禁止重试。 */
    @Test
    void structuredExtractionAndScopedRagUseActualProtocol() throws Exception {
        var json = JsonMapper.builder().build();
        var calls = new AtomicInteger();
        var request = new AtomicReference<String>();
        var content = new AtomicReference<>("{\"drafts\":[]}");
        var finish = new AtomicReference<>("stop");
        var status = new AtomicInteger(200);
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/chat/completions", exchange -> {
            calls.incrementAndGet();
            request.set(
                new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)
            );
            byte[] response = json.writeValueAsBytes(
                Map.of(
                    "id",
                    "test-id",
                    "object",
                    "chat.completion",
                    "created",
                    100,
                    "model",
                    "test-model",
                    "choices",
                    List.of(
                        Map.of(
                            "index",
                            0,
                            "message",
                            Map.of("role", "assistant", "content", content.get()),
                            "finish_reason",
                            finish.get()
                        )
                    ),
                    "usage",
                    Map.of("prompt_tokens", 12, "completion_tokens", 7, "total_tokens", 19)
                )
            );
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status.get(), response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try {
            var settings = new AiProperties(
                true,
                "test-model",
                "test-key",
                "http://127.0.0.1:" + server.getAddress().getPort(),
                "test-only-bridge-key-at-least-32-characters",
                20,
                50
            );
            var factory = new DefaultListableBeanFactory();
            factory.registerSingleton("eventChatClient", new AiConfig().eventChatClient(settings));
            var client = new DeepSeekEventAiClient(factory.getBeanProvider(ChatClient.class));
            var extraction = client.extract("只输出 JSON", "明天开会", EventExtraction.class);
            assertThat(extraction.value().drafts()).isEmpty();
            assertThat(extraction.inputTokens()).isEqualTo(12);
            var body = json.readTree(request.get());
            assertThat(body.path("max_tokens").asInt()).isEqualTo(1800);
            assertThat(body.at("/response_format/type").asText()).isEqualTo("json_object");
            assertThat(body.at("/thinking/type").asText()).isEqualTo("disabled");
            assertThat(body.has("tools")).isFalse();
            content.set("{\"claims\":[{\"text\":\"通过检查配置解决\",\"sourceIds\":[\"D1\"]}]}");
            var answer = client.answer(
                "仅依据证据输出 JSON",
                "怎么解决？",
                List.of(new Document("D1", "D1 本人的项目：检查配置后解决", Map.of())),
                AnswerExtraction.class
            );
            assertThat(answer.value().claims()).hasSize(1);
            assertThat(request.get()).contains("本人的项目");
            assertThat(request.get()).contains("怎么解决");
            content.set(
                "{\"drafts\":[{\"index\":0,\"date\":\"2026-11-19\",\"title\":\"开会\",\"domain\":\"work\",\"durationMinutes\":1.5,\"questions\":[]}]}"
            );
            assertThatThrownBy(() ->
                client.extract("JSON", "开会", EventExtraction.class)
            ).isInstanceOf(RuntimeException.class);
            content.set("{\"drafts\":[]}");
            finish.set("length");
            assertThatThrownBy(() ->
                client.extract("JSON", "开会", EventExtraction.class)
            ).hasMessageContaining("未完整");
            status.set(400);
            int before = calls.get();
            assertThatThrownBy(() ->
                client.extract("JSON", "开会", EventExtraction.class)
            ).isInstanceOf(RuntimeException.class);
            assertThat(calls.get()).isEqualTo(before + 1);
        } finally {
            server.stop(0);
        }
    }
}
