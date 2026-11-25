package cn.imlaomi.cloud.calendar.service;

import cn.imlaomi.cloud.calendar.client.AiModelClient;
import cn.imlaomi.cloud.calendar.dto.AiDtos.*;
import java.time.*;
import java.util.List;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * 自然语言计划录入的业务编排：输入校验 → 请求治理 → 提示词与模型 → 结果校验 → 草稿响应。
 *
 * <p>模型适配、幂等配额和确定性校验分别委托给对应组件，本类不直接依赖 Redis 或 MyBatis。
 * 只返回建议，不写入用户日历，不生成提醒或分享关系。
 */
@Service
public class AiEventService {

    private final AiRequestService requests;
    private final AiModelClient model;
    private final AiDraftValidationService validation;
    private final ObjectMapper json;

    /**
     * 发给模型的输入上下文，与前端请求分离，不携带账号、令牌和模型密钥。
     *
     * @param text 用户输入的自然语言，作为待提取数据而非系统指令
     * @param referenceDate 服务端本次请求的北京时间日期，用于解释“今天、明天”等相对表达
     * @param selectedDate 用户在日历中选中的日期，没有明确日期时供提示词使用
     * @param timezone 当前支持的时区 Asia/Shanghai
     * @param defaultDomain 无法判断工作或生活时使用的默认分类
     */
    public record Input(
        String text,
        String referenceDate,
        String selectedDate,
        String timezone,
        String defaultDomain
    ) {}

    /** 注入用量、模型与确定性校验。 */
    public AiEventService(
        AiRequestService requests,
        AiModelClient model,
        AiDraftValidationService validation,
        ObjectMapper json
    ) {
        this.requests = requests;
        this.model = model;
        this.validation = validation;
        this.json = json;
    }

    /**
     * 生成一次计划草稿；同账号同请求内容的成功重放优先复用短期缓存。
     *
     * <p>先限制原文与业务参数，再取得北京时间参考日期。只有请求治理允许执行时，
     * 才读取版本化提示词并调用模型；模型输出仍需校验日期、分类和分钟值。
     * 无事项返回 NO_EVENT，有待确认问题返回 NEEDS_CLARIFICATION，其余返回 READY。
     *
     * @param account 已验证的账号，用于幂等身份、用量和缓存隔离
     * @param request 原文及本次录入上下文，clientRequestId 由前端生成
     * @return 可编辑草稿；成功缓存重放时保留原结果中的日期锚点，不重新计算“明天”
     */
    public EventResponse interpret(String account, EventRequest request) {
        validation.validate(request);
        // 与服务器部署时区、客户端选中日期区分，避免“明天”随选中日变化。
        LocalDate reference = LocalDate.now(ZoneId.of("Asia/Shanghai"));
        return requests.execute(
            account,
            request.clientRequestId(),
            "events",
            json.writeValueAsString(request),
            EventResponse.class,
            //lambda中的内容要在execute方法校验完成之后才会生效，从Result<T> result = operation.get();之后开始
            () -> {
                // Supplier 是受治理的业务动作；命中成功缓存时不会进入这里再次调用模型。
                String prompt;
                try {
                    prompt = new ClassPathResource(
                        "prompts/event-extract-v1.st"
                    ).getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
                } catch (java.io.IOException missing) {
                    throw new IllegalStateException("Missing event prompt");
                }
                // 系统提示词约束提取任务，用户原文与日期上下文放在独立的 user 消息中。
                var response = model.extract(
                    prompt,
                    json.writeValueAsString(
                        new Input(
                            request.text(),
                            reference.toString(),
                            request.selectedDate(),
                            request.timezone(),
                            request.defaultDomain()
                        )
                    ),
                    EventExtraction.class
                );
                // DTO 转换只解决结构问题；跨天时长、允许的分类等仍由程序校验。
                List<EventDraft> drafts = validation.validate(response.value(), request, reference);
                String status = drafts.isEmpty()
                    ? "NO_EVENT"
                    : drafts.stream().anyMatch(d -> !d.questions().isEmpty())
                      ? "NEEDS_CLARIFICATION"
                      : "READY";
                return new AiModelClient.Result<>(
                    new EventResponse(
                        request.clientRequestId(),
                        status,
                        reference.toString(),
                        "Asia/Shanghai",
                        drafts,
                        List.of("时间信息保存为计划文字，不会自动创建提醒；确认后先保存到本机。")
                    ),
                    response.inputTokens(),
                    response.outputTokens()
                );
            }
        );
    }
}
