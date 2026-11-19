package cn.imlaomi.cloud.calendar.config;

import java.io.*;
import java.time.Duration;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.deepseek.*;
import org.springframework.ai.deepseek.api.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.*;
import org.springframework.core.retry.*;
import org.springframework.http.client.*;
import org.springframework.web.client.RestClient;

/** 手动创建专用模型客户端，关闭时无需密钥，不影响普通日历启动。 */
@Configuration
@EnableConfigurationProperties(AiProperties.class)
public class AiConfig {

    /** 明确关闭自动重试、思考模式和工具执行，限制输出与读取大小。 */
    @Bean
    @ConditionalOnProperty(prefix = "cloud.ai", name = "enabled", havingValue = "true")
    ChatClient eventChatClient(AiProperties settings) {
        if (
            settings.apiKey() == null || settings.apiKey().isBlank()
        ) throw new IllegalStateException("AI enabled without backend API key");
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(3));
        factory.setReadTimeout(Duration.ofSeconds(25));
        var rest = RestClient.builder()
            .requestFactory(factory)
            .requestInterceptor((request, body, execution) -> {
                ClientHttpResponse response = execution.execute(request, body);
                long deadline = System.nanoTime() + Duration.ofSeconds(25).toNanos();
                return new ClientHttpResponse() {
                    /** 保留上游状态供 Spring AI 统一转换。 */
                    public org.springframework.http.HttpStatusCode getStatusCode()
                        throws IOException {
                        return response.getStatusCode();
                    }

                    /** 状态文本不写入业务日志。 */
                    public String getStatusText() throws IOException {
                        return response.getStatusText();
                    }

                    /** 保留必要响应头。 */
                    public org.springframework.http.HttpHeaders getHeaders() {
                        return response.getHeaders();
                    }

                    /** 限制响应体累计大小，并在每次读取时检查截止时间。 */
                    public InputStream getBody() throws IOException {
                        return new FilterInputStream(response.getBody()) {
                            int consumed;

                            /** 小块读取同样执行大小与时间限制。 */
                            public int read() throws IOException {
                                byte[] item = new byte[1];
                                return read(item, 0, 1) < 0 ? -1 : item[0] & 255;
                            }

                            /** 截断或超限时中断解析，调用结束后由请求作用域关闭连接。 */
                            public int read(byte[] buffer, int offset, int length)
                                throws IOException {
                                if (
                                    System.nanoTime() > deadline || consumed > 1048576
                                ) throw new IOException("AI response limit exceeded");
                                int count = super.read(
                                    buffer,
                                    offset,
                                    Math.min(length, 1048577 - consumed)
                                );
                                if (count > 0) consumed += count;
                                if (
                                    consumed > 1048576 || System.nanoTime() > deadline
                                ) throw new IOException("AI response limit exceeded");
                                return count;
                            }
                        };
                    }

                    /** 始终释放提供商响应连接。 */
                    public void close() {
                        response.close();
                    }
                };
            });
        var api = DeepSeekApi.builder()
            .baseUrl(settings.baseUrl())
            .apiKey(settings.apiKey())
            .restClientBuilder(rest)
            .build();
        var options = DeepSeekChatOptions.builder()
            .model(settings.model())
            .disableThinking()
            .maxTokens(1800)
            .responseFormat(ResponseFormat.builder().type(ResponseFormat.Type.JSON_OBJECT).build())
            .build();
        var model = DeepSeekChatModel.builder()
            .deepSeekApi(api)
            .options(options)
            .retryTemplate(new RetryTemplate(RetryPolicy.withMaxRetries(0)))
            .build();
        return ChatClient.builder(model).build();
    }
}
