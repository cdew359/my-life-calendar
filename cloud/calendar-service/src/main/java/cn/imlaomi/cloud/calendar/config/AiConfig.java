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

/**
 * Spring 管理的专用 ChatClient 配置，供 DeepSeekEventAiClient 通过 ObjectProvider 按需取得。
 *
 * <p>AI 关闭时不创建模型客户端，因此普通日历启动不要求模型密钥。
 * 启用时在后端集中设置传输保护、模型名、非思考模式、JSON 输出和零自动重试，
 * 不在 Controller 或前端重复配置，不注册业务写入工具。
 */
@Configuration
@EnableConfigurationProperties(AiProperties.class)
public class AiConfig {

    /**
     * 仅在 cloud.ai.enabled=true 时创建专用模型客户端，并交给 Spring 作为 Bean 管理。
     *
     * <p>传输层设置3秒连接超时、25秒读取超时，并检查响应体读取窗口与1MB累计大小。
     * 读取窗口在取得响应后建立，阻塞读取结束才再次检查，因此不是严格25秒总调用时限。
     * 模型限制最多1800输出 token，关闭思考、不注册工具，并禁用自动 HTTP 重试，
     * 避免一次用户操作因重试重复产生费用；未知结果由请求幂等层保守处理。
     *
     * @param settings 仅在后端注入的模型配置，密钥不进入响应或前端
     * @return 供结构化提取与 RAG 问答共用的 ChatClient
     * @throws IllegalStateException 显式启用但没有配置模型密钥
     */
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
        // DeepSeekApi 处理提供商 HTTP 协议，ChatModel 封装模型参数，ChatClient 提供业务调用链。
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
