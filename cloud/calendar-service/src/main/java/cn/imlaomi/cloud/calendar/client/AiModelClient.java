package cn.imlaomi.cloud.calendar.client;

import java.util.List;
import org.springframework.ai.document.Document;

/** 业务层只依赖明确的模型调用边界，保留用量供审计。 */
public interface AiModelClient {
    record Result<T>(T value, Integer inputTokens, Integer outputTokens) {}

    /** 从自然语言提取事件草稿。 */
    <T> Result<T> extract(String system, String user, Class<T> type);
    /** 通过 Spring AI RAG Advisor 将已鉴权资料用于结构化回答。 */
    <T> Result<T> answer(String system, String question, List<Document> evidence, Class<T> type);
}
