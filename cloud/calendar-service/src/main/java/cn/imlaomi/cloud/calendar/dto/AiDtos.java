package cn.imlaomi.cloud.calendar.dto;

import java.util.List;

/**
 * AI 功能的接口和模型输出 DTO，区分外部请求、模型提取结构与对外业务响应。
 * 不携带账号归属、登录令牌、模型密钥、工具指令或推理过程；账号由鉴权上下文提供。
 * record 只描述数据形状，字段约束由 Service 校验，不代表自动完成业务校验。
 */
public final class AiDtos {

    /**
     * 用户主动生成计划草稿时的请求，不在普通输入或保存计划时自动发送。
     *
     * @param clientRequestId 本次操作的 UUID，同账号同内容重放用于幂等，主动重新生成应换新值
     * @param text 待提取原文，1～1000 字
     * @param selectedDate 日历选中日期 YYYY-MM-DD，未明确日期时作为提示词的默认值
     * @param timezone 当前固定为 Asia/Shanghai，相对日期锚点由服务端另行确定
     * @param defaultDomain 默认分类，只允许 work 或 life
     */
    public record EventRequest(
        String clientRequestId,
        String text,
        String selectedDate,
        String timezone,
        String defaultDomain
    ) {}

    /**
     * 单条可编辑草稿，不等同于已经持久化的 Plan。
     *
     * @param index 校验后的0～4顺序编号，前端与请求 UUID 组合产生稳定保存 ID
     * @param date 计划日期 YYYY-MM-DD
     * @param title 事项文本，1～200 字，不额外推断参与人或行动
     * @param domain 工作 work 或生活 life
     * @param startTime 明确的开始时刻 HH:mm，未明确时为 null
     * @param endDate 明确结束日期；有结束时刻但没有结束日期时，业务校验按计划当日处理
     * @param endTime 明确结束时刻 HH:mm，为 null 时不执行起止时间运算
     * @param durationMinutes 预计整数分钟，可空；明确起止时间时由程序重算，范围1～10080
     * @param unresolvedTimeText “晚上”等未明确的时间原表达，可空，不擅自换成具体时刻
     * @param questions 待用户确认的疑问项；前端对非空疑问的草稿默认不勾选
     */
    public record EventDraft(
        int index,
        String date,
        String title,
        String domain,
        String startTime,
        String endDate,
        String endTime,
        Integer durationMinutes,
        String unresolvedTimeText,
        List<String> questions
    ) {}

    /** 模型只输出草稿列表；业务状态、参考日期和提示由服务端生成，不让模型决定。 */
    public record EventExtraction(List<EventDraft> drafts) {}

    /**
     * 对外的计划草稿响应，不包含模型原文或推理。
     *
     * @param requestId 原请求 UUID，前端校验响应是否属于本次操作
     * @param status READY、NEEDS_CLARIFICATION 或 NO_EVENT，仅表示提取状态，不表示保存成功
     * @param referenceDate 本次生成使用的北京时间日期，缓存重放不更新该日期
     * @param timezone 当前固定为 Asia/Shanghai
     * @param drafts 已通过业务校验的草稿集合，允许没有事项
     * @param warnings 时间仅保存为文字、需要确认等可展示提示
     */
    public record EventResponse(
        String requestId,
        String status,
        String referenceDate,
        String timezone,
        List<EventDraft> drafts,
        List<String> warnings
    ) {}

    /**
     * 日记问答请求；检索词和日期过滤由用户指定，不允许指定其他账号。
     *
     * @param clientRequestId 本次问答的 UUID，用于幂等与缓存身份
     * @param question 1～1000 字问题，不用于执行工具或写入操作
     * @param keywords 1～100 字 ES 检索关键词，不是自定义 Elasticsearch DSL
     * @param from 最早日记日期，YYYY-MM-DD，空值表示不限定该侧
     * @param to 最晚日记日期，YYYY-MM-DD，空值表示不限定该侧
     */
    public record KnowledgeRequest(
        String clientRequestId,
        String question,
        String keywords,
        String from,
        String to
    ) {}

    /**
     * 模型归纳的单条结论；编号必须属于本次证据，仍需用户对照原文判断事实。
     *
     * @param text 单条结论，业务层限制非空且最多1500字
     * @param sourceIds 支持该结论的已有来源编号，如 D1，至少一个且最多五个
     */
    public record SupportedClaim(String text, List<String> sourceIds) {}

    /** 模型回答的中间结构，最多八条结论；空列表表示证据不足，不能支持回答。 */
    public record AnswerExtraction(List<SupportedClaim> claims) {}

    /**
     * 对外日记问答结果，答案与来源统一经过业务层检查后返回。
     *
     * @param requestId 原问答 UUID
     * @param answer 带来源编号的结论文本，或无证据、证据不足的明确提示
     * @param sources 本次可打开原文的证据列表，不是全部日记
     * @param coverage 检索覆盖说明，避免将片段回答当作全量统计
     * @param warnings 索引尚在更新等提示，可能影响召回完整性
     */
    public record AnswerResponse(
        String requestId,
        String answer,
        List<cn.imlaomi.cloud.common.dto.KnowledgeDtos.Evidence> sources,
        String coverage,
        List<String> warnings
    ) {}

    /**
     * 配置层能力标记，不调用模型，不代表依赖实时健康。
     *
     * @param enabled AI 总开关与密钥配置是否满足启用条件
     * @param events 是否显示计划提取能力，当前沿用总开关
     * @param knowledge 是否显示日记问答能力，当前沿用总开关
     */
    public record Capabilities(boolean enabled, boolean events, boolean knowledge) {}
}
