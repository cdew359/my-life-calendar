package cn.imlaomi.cloud.diary.service;

import cn.imlaomi.cloud.common.dto.KnowledgeDtos.*;
import cn.imlaomi.cloud.common.exception.ApiException;
import cn.imlaomi.cloud.diary.dao.DiarySearchDao;
import cn.imlaomi.cloud.diary.util.DiaryDates;
import java.util.*;
import org.springframework.stereotype.Service;

/** RAG 检索只输出当前账号当前版本的少量日记片段。 */
@Service
public class DiaryRetrievalService {

    private final DiarySearchDao search;
    private final DiaryEntryService entries;

    /** 注入已有全文索引和权威日记数据源。 */
    public DiaryRetrievalService(DiarySearchDao search, DiaryEntryService entries) {
        this.search = search;
        this.entries = entries;
    }

    /** ES 仅用于召回，所有正文和版本必须从账号范围内的 MySQL 回查。 */
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

    /** 删除、编辑或账号不匹配时，拒绝返回旧回答和旧缓存。 */
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
