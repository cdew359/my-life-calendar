package cn.imlaomi.cloud.calendar.client;

import cn.imlaomi.cloud.common.exception.ApiException;
import java.util.List;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.converter.BeanOutputConverter;
import org.springframework.ai.document.Document;
import org.springframework.ai.rag.advisor.RetrievalAugmentationAdvisor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Spring AI 的结构化转换和 RAG Advisor 只存在于模型适配边界。 */
@Component
public class DeepSeekEventAiClient implements AiModelClient {

    private final ObjectProvider<ChatClient> clients;

    /** 延迟取得模型客户端，功能关闭时允许服务正常启动。 */
    public DeepSeekEventAiClient(ObjectProvider<ChatClient> clients) {
        this.clients = clients;
    }

    /** 请求明确的事件 DTO，携带用量返回给审计层。 */
    @Override
    public <T> Result<T> extract(String system, String user, Class<T> type) {
        var response = client()
            .prompt()
            .system(system)
            .user(user)
            .call()
            .responseEntity(converter(type));
        return result(response.response(), response.entity());
    }

    /** 通过请求局部的不可变证据列表构建 RAG，防止共享租户上下文串号。 */
    @Override
    public <T> Result<T> answer(
        String system,
        String question,
        List<Document> evidence,
        Class<T> type
    ) {
        List<Document> scoped = List.copyOf(evidence);
        var advisor = RetrievalAugmentationAdvisor.builder()
            .documentRetriever(query -> scoped)
            .build();
        var response = client()
            .prompt()
            .system(system)
            .advisors(advisor)
            .user(question)
            .call()
            .responseEntity(converter(type));
        return result(response.response(), response.entity());
    }

    /** 不返回未启用状态下的空客户端。 */
    private ChatClient client() {
        ChatClient client = clients.getIfAvailable();
        if (client == null) throw new ApiException(503, "AI 尚未启用");
        return client;
    }

    /** 小数不能被静默截断为整数分钟，尾随 JSON 同样视为无效输出。 */
    private <T> BeanOutputConverter<T> converter(Class<T> type) {
        return new BeanOutputConverter<>(
            type,
            JsonMapper.builder()
                .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
                .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .build()
        );
    }

    /** 缺少用量保持未知；截断或空结果不能成为成功草稿。 */
    private <T> Result<T> result(ChatResponse response, T entity) {
        if (
            response == null ||
            response.getResult() == null ||
            entity == null ||
            !"STOP".equalsIgnoreCase(response.getResult().getMetadata().getFinishReason())
        ) throw new ApiException(502, "AI 输出未完整完成，请修改输入后重新生成");
        var usage = response.getMetadata().getUsage();
        return new Result<>(
            entity,
            usage == null ? null : usage.getPromptTokens(),
            usage == null ? null : usage.getCompletionTokens()
        );
    }
}
