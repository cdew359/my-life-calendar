package cn.imlaomi.cloud.calendar.client;

import cn.imlaomi.cloud.common.dto.KnowledgeDtos.*;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/** 私网日记检索，只发送绑定账号和请求体的短期签名。 */
@FeignClient(name = "diary-service", contextId = "aiDiaryKnowledge")
public interface DiaryKnowledgeClient {
    /** 取得已经按当前日记版本回查的最小证据片段。 */
    @PostMapping(value = "/internal/ai/diaries/retrieve", consumes = "application/json")
    EvidenceResponse retrieve(
        @RequestHeader("X-AI-Bridge-Token") String token,
        @RequestBody String body
    );

    /** 回答返回或缓存重放前检查引用是否仍可见且版本未变化。 */
    @PostMapping(value = "/internal/ai/diaries/verify", consumes = "application/json")
    Verification verify(@RequestHeader("X-AI-Bridge-Token") String token, @RequestBody String body);
}
