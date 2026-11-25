package cn.imlaomi.cloud.calendar.controller;

import cn.imlaomi.cloud.calendar.config.AiProperties;
import cn.imlaomi.cloud.calendar.dto.AiDtos.*;
import cn.imlaomi.cloud.calendar.service.*;
import cn.imlaomi.cloud.common.util.AiBridgeTokens;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

/** 供 Node 后端内部调用的 AI 接口。 */
@RestController
public class InternalAiEventController {

    private final AiBridgeTokens tokens;
    private final AiEventService events;
    private final KnowledgeService knowledge;
    private final AiRequestService requests;
    private final ObjectMapper json;

    /** 注入独立桥接密钥与相同业务实现。 */
    public InternalAiEventController(
        AiProperties settings,
        AiEventService events,
        KnowledgeService knowledge,
        AiRequestService requests,
        ObjectMapper json
    ) {
        this.tokens = new AiBridgeTokens(settings.bridgeSecret());
        this.events = events;
        this.knowledge = knowledge;
        this.requests = requests;
        this.json = json;
    }

    /** 供 Node 后端查询 AI 功能是否已启用。 */
    @PostMapping("/internal/ai/capabilities")
    public Capabilities capabilities(
        @RequestHeader(value = "X-AI-Bridge-Token", required = false) String token,
        @RequestBody String body
    ) {
        tokens.verify(token, "ai-capabilities", body);
        return new Capabilities(requests.enabled(), requests.enabled(), requests.enabled());
    }

    /** 处理 Node 转发的自然语言录入请求，返回计划草稿。 */
    @PostMapping("/internal/ai/events/interpret")
    public EventResponse events(
        @RequestHeader(value = "X-AI-Bridge-Token", required = false) String token,
        @RequestBody String body
    ) {
        String account = tokens.verify(token, "ai-events", body);
        return events.interpret(account, json.readValue(body, EventRequest.class));
    }

    /** 处理 Node 转发的日记问答请求，返回答案与来源。 */
    @PostMapping("/internal/ai/knowledge/ask")
    public AnswerResponse ask(
        @RequestHeader(value = "X-AI-Bridge-Token", required = false) String token,
        @RequestBody String body
    ) {
        String account = tokens.verify(token, "ai-knowledge", body);
        return knowledge.ask(account, json.readValue(body, KnowledgeRequest.class));
    }
}
