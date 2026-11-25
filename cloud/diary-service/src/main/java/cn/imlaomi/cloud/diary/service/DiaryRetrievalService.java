package cn.imlaomi.cloud.diary.service;

import cn.imlaomi.cloud.common.dto.KnowledgeDtos.*;
import cn.imlaomi.cloud.common.exception.ApiException;
import cn.imlaomi.cloud.diary.dao.DiarySearchDao;
import cn.imlaomi.cloud.diary.util.DiaryDates;
import java.util.*;
import org.springframework.stereotype.Service;

/**
 * RAG 的检索与证据验证业务，不调用模型，也不直接把 ES 中的正文返回给 AI。
 *
 * <p>ES 负责按账号和筛选条件召回候选，MySQL 负责正文可见性与版本。
 * 用最少的当前有效片段作为模型上下文，避免全量日记发送和陈旧索引泄露旧内容。
 */
@Service
public class DiaryRetrievalService {

    private final DiarySearchDao search;
    private final DiaryEntryService entries;

    /** 注入已有全文索引和权威日记数据源。 */
    public DiaryRetrievalService(DiarySearchDao search, DiaryEntryService entries) {
        this.search = search;
        this.entries = entries;
    }

    /**
     * 召回相关日记，并从当前账号的 MySQL 记录构建最多五条有效证据。
     *
     * <p>过期版本、已删除或缺失记录不成为证据，并设置 indexing 提示可能不完整。
     * 每个片段最多1000字符，优先在完整关键词匹配点前200字符开始截取；
     * 找不到完整匹配（例如多个召回关键词）时从正文开头截取，不承诺覆盖所有相关句子。
     *
     * @param account 内部 Controller 从有效签名提取的账号，不接受模型决定
     * @param request 普通关键词和可选的闭区间日期范围
     * @return 本次分配 D1～D5 编号的证据及索引落后提示，不包含完整日记正文
     */
    public EvidenceResponse retrieve(String account, Search request) {
        if (
            request == null ||
            request.keywords() == null ||
            request.keywords().isBlank() ||
            request.keywords().length() > 100
        ) throw new ApiException(400, "检索关键词无效");
        String from = Objects.toString(request.from(), ""),
            to = Objects.toString(request.to(), "");
        if (!from.isEmpty()) DiaryDates.requireDate(from);
        if (!to.isEmpty()) DiaryDates.requireDate(to);
        if (!from.isEmpty() && !to.isEmpty() && from.compareTo(to) > 0) throw new ApiException(
            400,
            "日期范围无效"
        );
        var hits = search.retrieve(account, request.keywords(), from, to);
        List<Evidence> result = new ArrayList<>();
        boolean indexing = false;
        for (var hit : hits.hits()) {
            if (result.size() >= 5) break;
            // 候选只有日期与版本；正文必须重新按账号查询，不能信任 ES 旧副本仍可见。
            var entry = entries.get(account, hit.date());
            if (entry == null || entry.deleted() || entry.revision() != hit.revision()) {
                indexing = true;
                continue;
            }
            String content = entry.content();
            int match = content
                .toLowerCase(Locale.ROOT)
                .indexOf(request.keywords().toLowerCase(Locale.ROOT));
            int start = Math.max(0, match - 200),
                end = Math.min(content.length(), start + 1000);
            result.add(
                new Evidence(
                    "D" + (result.size() + 1),
                    entry.date(),
                    entry.title(),
                    content.substring(start, end),
                    entry.revision()
                )
            );
        }
        return new EvidenceResponse(List.copyOf(result), indexing);
    }

    /**
     * 复核引用是否仍可见，用于新答案返回前和成功缓存重放时拒绝旧版本。
     *
     * <p>按签名账号读取每条引用日期，只比较存在性、删除状态与 revision；
     * 不信任请求携带的标题/片段，也不验证模型结论与原文是否语义一致。
     * 空列表不需要复核，可返回 true。
     *
     * @param account 已验证账号，同日期在另一账号下的记录不会被使用
     * @param request 至多五条待验证的来源
     * @return 所有来源均存在、未删除且版本匹配时 valid=true，否则 false
     */
    public Verification verify(String account, References request) {
        if (
            request == null || request.sources() == null || request.sources().size() > 5
        ) throw new ApiException(400, "来源列表无效");
        for (var source : request.sources()) {
            if (source == null) return new Verification(false);
            DiaryDates.requireDate(source.date());
            var entry = entries.get(account, source.date());
            if (
                entry == null || entry.deleted() || entry.revision() != source.revision()
            ) return new Verification(false);
        }
        return new Verification(true);
    }
}
