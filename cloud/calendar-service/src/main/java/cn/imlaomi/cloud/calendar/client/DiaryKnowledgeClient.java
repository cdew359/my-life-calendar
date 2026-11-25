package cn.imlaomi.cloud.calendar.client;

import cn.imlaomi.cloud.common.dto.KnowledgeDtos.*;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * calendar-service 调用 diary-service 的 OpenFeign 边界，服务名通过注册发现解析。
 * 两个接口只发送原始 JSON 和独立 AI 签名，账号归属由日记服务再次验证；
 * 此客户端不持有用户登录 token，不让模型选择 URL 或账号。
 */
@FeignClient(name = "diary-service", contextId = "aiDiaryKnowledge")
public interface DiaryKnowledgeClient {
    /**
     * 取得已按当前账号、删除状态和权威版本回查的最小证据片段。
     *
     * @param token 绑定 diary-retrieve 用途、账号与 body 的短期签名
     * @param body Search 的序列化 JSON，签名后不可重新排版或改动
     * @return 最多五条来源和索引可能落后的提示
     */
    @PostMapping(value = "/internal/ai/diaries/retrieve", consumes = "application/json")
    EvidenceResponse retrieve(
        @RequestHeader("X-AI-Bridge-Token") String token,
        @RequestBody String body
    );

    /**
     * 回答返回和缓存重放前，检查引用日记是否仍在当前账号下可见且版本未变化。
     *
     * @param token 独立的 diary-verify 用途签名，不能重用检索用途的凭据
     * @param body References 的序列化 JSON
     * @return 所有来源的存在性、删除状态和版本是否仍匹配，不做语义核验
     */
    @PostMapping(value = "/internal/ai/diaries/verify", consumes = "application/json")
    Verification verify(@RequestHeader("X-AI-Bridge-Token") String token, @RequestBody String body);
}
