package cn.imlaomi.cloud.diary.service;

import cn.imlaomi.cloud.common.exception.ApiException;
import cn.imlaomi.cloud.diary.dao.DiaryEntryDao;
import cn.imlaomi.cloud.diary.dao.DiaryOutboxDao;
import cn.imlaomi.cloud.diary.entity.DiaryEntryEntity;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DiaryEntryService {

    private final DiaryEntryDao diaryEntryDao;
    private final DiaryOutboxDao outboxDao;

    /** 注入访问共享 MySQL 日记表所需的数据访问工具。 */
    public DiaryEntryService(DiaryEntryDao diaryEntryDao, DiaryOutboxDao outboxDao) {
        this.outboxDao = outboxDao;
        this.diaryEntryDao = diaryEntryDao;
    }

    /** 读取指定账号某一天的日记行。 */
    public DiaryEntryEntity get(String account, String date) {
        return get(account, date, false);
    }

    /** 按账号和日期读取日记，可在写入事务中选择加排他锁。 */
    DiaryEntryEntity get(String account, String date, boolean lock) {
        return lock
            ? diaryEntryDao.findForUpdate(account, date)
            : diaryEntryDao.find(account, date);
    }

    /**
     * 在同一事务中保存日记及索引任务。先取得排他锁再检查版本，避免两个设备同时保存时发生锁升级死锁。
     *
     * @param account 从鉴权上下文取得的账号标识，不能使用客户端自行指定的归属账号
     * @param date 已校验的 YYYY-MM-DD 日期
     * @param title 新标题；删除时保留原标题
     * @param content 新正文；删除时保留原正文
     * @param revision 客户端最后读取的版本，必须与数据库当前版本一致
     * @param deleted 是否执行软删除
     * @return 已递增版本的日记快照
     * @throws ApiException 预期版本不匹配，或尝试删除尚不存在的日记时返回 409
     */
    @Transactional
    public DiaryEntryEntity write(
        String account,
        String date,
        String title,
        String content,
        int revision,
        boolean deleted
    ) {
        long now = System.currentTimeMillis();
        // Obtain the exclusive lock before reading the revision; avoid duplicate-key shared-lock upgrades.
        diaryEntryDao.ensureRow(account, date, now);
        DiaryEntryEntity old = get(account, date, true);
        if (old.revision() != revision || (deleted && old.revision() == 0)) throw new ApiException(
            409,
            "日记已被另一设备修改，请先载入云端版本"
        );
        if (deleted) {
            title = old.title();
            content = old.content();
        }
        int next = Math.addExact(revision, 1);
        DiaryEntryEntity updated = new DiaryEntryEntity(
            date,
            title,
            content,
            next,
            old.createdAt(),
            now,
            deleted
        );
        diaryEntryDao.update(account, updated);
        outboxDao.enqueue(account, date);
        return updated;
    }
}
