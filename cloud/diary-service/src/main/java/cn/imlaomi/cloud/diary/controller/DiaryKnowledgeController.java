package cn.imlaomi.cloud.diary.controller;

import cn.imlaomi.cloud.common.dto.KnowledgeDtos.*;
import cn.imlaomi.cloud.common.util.AiBridgeTokens;
import cn.imlaomi.cloud.diary.service.DiaryRetrievalService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

/** 私网 RAG 接口，只从短期签名中取得账号，公开请求不能自选账号。 */
@RestController
public class DiaryKnowledgeController {

    private final AiBridgeTokens tokens;
    private final DiaryRetrievalService retrieval;
    private final ObjectMapper json;

    /** 注入独立 AI 桥接密钥，不改变原有内部接口密钥。 */
    public DiaryKnowledgeController(
        @Value("${AI_BRIDGE_SECRET:}") String secret,
        DiaryRetrievalService retrieval,
        ObjectMapper json
    ) {
        this.tokens = new AiBridgeTokens(secret);
        this.retrieval = retrieval;
        this.json = json;
    }

    /** 验证用途和原始请求体后检索本人资料。 */
    @PostMapping("/internal/ai/diaries/retrieve")
    public EvidenceResponse retrieve(
        @RequestHeader(value = "X-AI-Bridge-Token", required = false) String token,
        @RequestBody String body
    ) {
        String account = tokens.verify(token, "diary-retrieve", body);
        return retrieval.retrieve(account, json.readValue(body, Search.class));
    }

    /** 确认引用日记仍可见且未修改。 */
    @PostMapping("/internal/ai/diaries/verify")
    public Verification verify(
        @RequestHeader(value = "X-AI-Bridge-Token", required = false) String token,
        @RequestBody String body
    ) {
        String account = tokens.verify(token, "diary-verify", body);
        return retrieval.verify(account, json.readValue(body, References.class));
    }
}
