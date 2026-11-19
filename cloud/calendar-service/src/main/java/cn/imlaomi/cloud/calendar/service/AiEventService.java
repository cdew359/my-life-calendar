package cn.imlaomi.cloud.calendar.service;

import cn.imlaomi.cloud.calendar.client.AiModelClient;
import cn.imlaomi.cloud.calendar.dto.AiDtos.*;
import java.time.*;
import java.util.List;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/** 自然语言仅生成草稿，服务端不直接写入用户日历。 */
@Service
public class AiEventService {

    private final AiRequestService requests;
    private final AiModelClient model;
    private final AiDraftValidationService validation;
    private final ObjectMapper json;

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

    /** 固定参考日期并返回经校验的草稿，重复请求复用原结果。 */
    public EventResponse interpret(String account, EventRequest request) {
        validation.validate(request);
        LocalDate reference = LocalDate.now(ZoneId.of("Asia/Shanghai"));
        return requests.execute(
            account,
            request.clientRequestId(),
            "events",
            json.writeValueAsString(request),
            EventResponse.class,
            () -> {
                String prompt;
                try {
                    prompt = new ClassPathResource(
                        "prompts/event-extract-v1.st"
                    ).getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
                } catch (java.io.IOException missing) {
                    throw new IllegalStateException("Missing event prompt");
                }
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
