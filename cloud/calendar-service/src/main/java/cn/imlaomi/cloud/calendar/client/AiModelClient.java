package cn.imlaomi.cloud.calendar.client;

import java.util.List;
import org.springframework.ai.document.Document;

/**
 * 模型适配边界：业务层只依赖结构化输入输出，不绑定 DeepSeek HTTP 协议或 Spring AI 调用细节。
 * 测试可替换此接口；实现层不负责鉴权、配额、写日历或校验业务引用。
 */
public interface AiModelClient {
    /**
     * 结构化业务结果及上游用量，供请求治理层写入元数据审计。
     *
     * @param value 转换后的业务 DTO，不包含模型推理过程
     * @param inputTokens 适配层取得的输入 token 数；无法取得时允许 null
     * @param outputTokens 适配层取得的输出 token 数；无法取得时允许 null
     * @param <T> 事件提取或回答提取等明确的 DTO 类型
     */
    record Result<T>(T value, Integer inputTokens, Integer outputTokens) {}

    /**
     * 根据系统约束和用户输入执行一次结构化提取，不主动检索历史日记。
     *
     * @param system 系统提示词，描述字段规则和任务边界
     * @param user 用户原文及服务端补充的日期上下文
     * @param type 期望的结构化输出类型，业务层仍需另行校验结果
     * @param <T> 输出 DTO 类型
     * @return 转换后的提取结果和用量
     */
    <T> Result<T> extract(String system, String user, Class<T> type);
    /**
     * 将已鉴权并回查版本的证据用于一次结构化回答，不扩大调用方限定的材料范围。
     *
     * @param system 回答约束，例如只能依据证据、每条结论必须引用来源
     * @param question 当前问题，不作为系统指令执行
     * @param evidence 当前账号本次检索的证据；账号隔离与版本检查由业务层负责
     * @param type 回答提取 DTO 类型
     * @param <T> 输出 DTO 类型
     * @return 结构化回答和用量；不代表每条结论已经通过事实核验
     */
    <T> Result<T> answer(String system, String question, List<Document> evidence, Class<T> type);
}
