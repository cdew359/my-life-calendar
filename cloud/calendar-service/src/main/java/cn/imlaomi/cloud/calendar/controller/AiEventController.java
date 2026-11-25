package cn.imlaomi.cloud.calendar.controller;

import cn.imlaomi.cloud.calendar.dto.AiDtos.*;
import cn.imlaomi.cloud.calendar.service.*;
import cn.imlaomi.cloud.common.config.ApiSecurity;
import org.springframework.web.bind.annotation.*;

/** 提供 AI 计划草稿生成和日记问答接口。 */
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

    /** 查询 AI 功能是否已启用，不调用模型。 */
    @GetMapping("/api/ai/capabilities")
    public Capabilities capabilities() {
        return new Capabilities(requests.enabled(), requests.enabled(), requests.enabled());
    }

    /** 将自然语言转换为可编辑的计划草稿，待用户确认保存。 */
    @PostMapping("/api/ai/events/interpret")
    public EventResponse events(
        @RequestAttribute(ApiSecurity.ACCOUNT) String account,
        @RequestBody EventRequest body
    ) {
        return events.interpret(account, body);
    }

    /** 根据当前用户的相关日记回答问题，并返回原文来源。 */
    @PostMapping("/api/ai/knowledge/ask")
    public AnswerResponse ask(
        @RequestAttribute(ApiSecurity.ACCOUNT) String account,
        @RequestBody KnowledgeRequest body
    ) {
        return knowledge.ask(account, body);
    }
}
