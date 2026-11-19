package cn.imlaomi.cloud.calendar.controller;

import cn.imlaomi.cloud.calendar.dto.AiDtos.*;
import cn.imlaomi.cloud.calendar.service.*;
import cn.imlaomi.cloud.common.config.ApiSecurity;
import org.springframework.web.bind.annotation.*;

/** Cloud 用户通过已有鉴权调用 AI，不允许从请求体选账号。 */
@RestController
public class AiEventController {

    private final AiEventService events;
    private final KnowledgeService knowledge;
    private final AiRequestService requests;

    /** 注入 AI 业务与能力开关。 */
    public AiEventController(
        AiEventService events,
        KnowledgeService knowledge,
        AiRequestService requests
    ) {
        this.events = events;
        this.knowledge = knowledge;
        this.requests = requests;
    }

    /** 能力检查不触发模型调用或消耗配额。 */
    @GetMapping("/api/ai/capabilities")
    public Capabilities capabilities() {
        return new Capabilities(requests.enabled(), requests.enabled(), requests.enabled());
    }

    /** 提取日历计划草稿。 */
    @PostMapping("/api/ai/events/interpret")
    public EventResponse events(
        @RequestAttribute(ApiSecurity.ACCOUNT) String account,
        @RequestBody EventRequest body
    ) {
        return events.interpret(account, body);
    }

    /** 根据本人日记证据回答问题。 */
    @PostMapping("/api/ai/knowledge/ask")
    public AnswerResponse ask(
        @RequestAttribute(ApiSecurity.ACCOUNT) String account,
        @RequestBody KnowledgeRequest body
    ) {
        return knowledge.ask(account, body);
    }
}
