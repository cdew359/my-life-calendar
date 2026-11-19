package cn.imlaomi.cloud.diary.service;

import static cn.imlaomi.cloud.diary.util.DiaryDates.validDate;

import cn.imlaomi.cloud.common.exception.ApiException;
import cn.imlaomi.cloud.diary.dao.DiarySearchDao;
import cn.imlaomi.cloud.diary.dto.DiaryDtos.*;
import cn.imlaomi.cloud.diary.util.DiaryDates;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class DiaryService {

    private final DiaryEntryService entryService;
    private final DiarySearchDao searchDao;
    private final IndexWorker worker;
    private final String internalKey;

    /** 注入日记存储、搜索索引、补偿任务和内部接口密钥。 */
    public DiaryService(
        DiaryEntryService entryService,
        DiarySearchDao searchDao,
        IndexWorker worker,
        @Value("${cloud.internal-key}") String key
    ) {
        this.entryService = entryService;
        this.searchDao = searchDao;
        this.worker = worker;
        this.internalKey = key;
    }

    /** 读取当前账号指定日期的日记及版本，已删除记录仅返回版本信息。 */

    public GetDiaryResponse get(String account, String date) {
        DiaryDates.requireDate(date);
        var entry = entryService.get(account, date);
        return new GetDiaryResponse(
            entry == null || entry.deleted() ? null : DiaryEntryResponse.from(entry),
            entry == null ? 0 : entry.revision()
        );
    }

    /** 校验标题、正文及预期版本后保存日记，并触发索引补偿。 */

    public SaveDiaryResponse save(String account, String date, SaveDiaryRequest body) {
        DiaryDates.requireDate(date);
        return new SaveDiaryResponse(
            DiaryEntryResponse.from(
                entryService.write(
                    account,
                    date,
                    body.title(),
                    body.content(),
                    body.expectedRevision(),
                    false
                )
            ),
            true
        );
    }

    /** 按预期版本标记日记删除，防止覆盖其他设备的新修改。 */

    public DeleteDiaryResponse delete(String account, String date, DeleteDiaryRequest body) {
        DiaryDates.requireDate(date);
        return new DeleteDiaryResponse(
            entryService.write(account, date, "", "", body.expectedRevision(), true).revision()
        );
    }

    /** 校验关键词、日期范围和页码，检索后从数据库重新校验账号、删除状态与版本。 */

    public SearchDiaryResponse search(String account, String q, String from, String to, int page) {
        q = q.trim();
        if (
            q.isEmpty() ||
            q.length() > 100 ||
            page < 1 ||
            page > 100 ||
            (!from.isEmpty() && !validDate(from)) ||
            (!to.isEmpty() && !validDate(to)) ||
            (!from.isEmpty() && !to.isEmpty() && from.compareTo(to) > 0)
        ) throw new ApiException(400, "请输入1～100字关键词、有效日期范围及页码");
        var hits = searchDao.search(account, q, from, to, page);
        List<DiaryEntryResponse> items = new ArrayList<>();
        for (var hit : hits.hits()) {
            var e = entryService.get(account, hit.date());
            if (e != null && !e.deleted() && e.revision() == hit.revision()) items.add(
                DiaryEntryResponse.from(e)
            );
        }
        return new SearchDiaryResponse(
            items,
            hits.total(),
            page,
            20,
            items.size() != hits.hits().size()
        );
    }

    /** 校验服务间密钥后为已有日记重新创建持久化索引任务。 */

    public ReindexResponse reindex(String key) {
        if (
            key == null ||
            !MessageDigest.isEqual(
                internalKey.getBytes(StandardCharsets.UTF_8),
                key.getBytes(StandardCharsets.UTF_8)
            )
        ) throw new ApiException(403, "Forbidden");
        return new ReindexResponse(worker.reindex());
    }
}
