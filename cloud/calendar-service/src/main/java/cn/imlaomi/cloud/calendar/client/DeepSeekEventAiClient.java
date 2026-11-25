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

/**
 * 使用 Spring AI ChatClient 调用 DeepSeek 的模型适配器。
 *
 * <p>普通提取使用 system/user 消息，日记问答额外接入请求级 RAG Advisor。
 * 本类负责模型调用、JSON 到 DTO 的转换、结束原因检查和用量提取；
 * 字段业务校验及来源编号检查仍由 Service 完成。模型配置和禁用重试见 AiConfig。
 */
@Component
public class DeepSeekEventAiClient implements AiModelClient {

    private final ObjectProvider<ChatClient> clients;

    /** 延迟取得模型客户端，功能关闭时允许服务正常启动。 */
    public DeepSeekEventAiClient(ObjectProvider<ChatClient> clients) {
        this.clients = clients;
    }

    /**
     * 发起同步、非流式结构化提取，返回目标 DTO 与原始响应中的用量元数据。
     *
     * <p>prompt 构造本次对话，system 设置任务规则，user 提供待处理内容；
     * call 选择同步调用，responseEntity 执行调用并通过转换器提取业务对象。
     * 使用 responseEntity 而非仅取正文，是为了同时保留结束原因和用量。
     *
     * @param system 系统约束，不从用户原文直接拼成系统指令
     * @param user 用户原文与日期上下文
     * @param type 输出 DTO 类，由业务调用方指定
     * @param <T> 输出 DTO 类型
     * @return 结构化结果及审计所需用量，不自动写入任何日历数据
     */
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

    /**
     * 将业务层已经检索出的证据交给 RAG Advisor，组织上下文并取得结构化回答。
     *
     * <p>此处的 DocumentRetriever 只返回本次传入的 scoped 列表，不再次访问 ES，
     * 也不使用共享可变的“当前用户文档”状态。List.copyOf 固定列表成员，不代表深拷贝文档。
     * 按账号检索和 MySQL 版本回查已在上游完成；响应引用仍需 KnowledgeService 校验。
     *
     * @param system 回答和引用格式规则
     * @param question 当前问题
     * @param evidence 本次请求允许使用的少量证据文档
     * @param type 结构化回答类型
     * @param <T> 输出 DTO 类型
     * @return 回答提取结果及模型用量
     */
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

    /**
     * 按需取得 Spring 管理的 ChatClient；未启用 AI 时允许适配器存在，但调用时明确返回 503。
     * ObjectProvider 延迟查找 Bean，本身不会新建线程或触发模型网络请求。
     */
    private ChatClient client() {
        ChatClient client = clients.getIfAvailable();
        if (client == null) throw new ApiException(503, "AI 尚未启用");
        return client;
    }

    /**
     * 创建严格的结构化转换器，并向 Spring AI 提供目标 DTO 对应的输出格式约束。
     * 小数不能静默截断为整数分钟，主 JSON 后的多余 JSON token 也会拒绝；
     * 转换成功并不代表日期、耗时或证据编号满足业务规则。
     */
    private <T> BeanOutputConverter<T> converter(Class<T> type) {
        return new BeanOutputConverter<>(
            type,
            JsonMapper.builder()
                .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
                .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .build()
        );
    }

    /**
     * 只有正常 STOP 结束且已取得 DTO 的响应才能作为结果返回。
     *
     * <p>token 用量来自响应元数据，不在本地估算；元数据用量对象不存在时保留 null。
     * 长度截断、工具调用等其他结束原因不能被当作完整草稿或答案使用。
     *
     * @param response Spring AI 返回的完整聊天响应
     * @param entity 转换后的业务对象
     * @param <T> 结构化输出类型
     * @return 业务结果和可取得的 token 用量
     * @throws ApiException 响应为空、没有业务对象或非正常结束时返回 502
     */
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
