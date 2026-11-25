package cn.imlaomi.cloud.common.dto;

import java.util.List;

/** 日记服务向 AI 提供的最小、可校验的证据协议。 */
public final class KnowledgeDtos {

    /**
     * AI 编排服务发送给日记服务的检索条件；账号不放在请求体内，由内部签名绑定。
     *
     * @param question 原问题，当前召回只使用 keywords，保留问题供协议表达
     * @param keywords 经过业务校验的普通关键词，不是 ES 查询 DSL
     * @param from 最早日期，空值不限制下界
     * @param to 最晚日期，空值不限制上界
     */
    public record Search(String question, String keywords, String from, String to) {}

    /**
     * 当前账号日记经 MySQL 回查后形成的最小证据，不携带完整正文。
     *
     * @param id 检索服务在本次结果分配的 D1～D5 编号，不是数据库主键
     * @param date 原文日期，用于打开本人对应日记
     * @param title 日记标题
     * @param excerpt 最多1000字符的正文片段
     * @param revision 片段对应的权威版本，供回答返回前及缓存重放时再次验证
     */
    public record Evidence(String id, String date, String title, String excerpt, int revision) {}

    /**
     * @param items 当前检索最多五条可用证据
     * @param indexing 是否遇到过期、删除或缺失的候选，提示索引可能尚未追上权威数据
     */
    public record EvidenceResponse(List<Evidence> items, boolean indexing) {}

    /** 待复核的来源集合；日记服务按签名账号、日期和版本重新读取，不信任片段正文。 */
    public record References(List<Evidence> sources) {}

    /** 来源是否仍存在、未删除且版本匹配，不代表对模型结论进行了事实核验。 */
    public record Verification(boolean valid) {}
}
