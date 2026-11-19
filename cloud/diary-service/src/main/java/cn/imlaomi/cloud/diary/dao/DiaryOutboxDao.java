package cn.imlaomi.cloud.diary.dao;

import cn.imlaomi.cloud.diary.entity.DiaryOutboxJob;
import java.util.List;
import org.apache.ibatis.annotations.*;

/** 持久化索引任务，SQL 与业务重试策略分离。 */
@Mapper
public interface DiaryOutboxDao {
    /** 在日记保存事务中新增或重置任务。 */
    int enqueue(@Param("account") String account, @Param("date") String date);
    /** 在工作线程事务中认领一条到期任务，跳过其他线程锁定的行。 */
    List<DiaryOutboxJob> claim(@Param("now") long now);
    /** 移除已成功提交 ES 的任务。 */
    int delete(@Param("id") long id);
    /** 累加失败次数并保存下次重试时间。 */
    int defer(@Param("id") long id, @Param("nextAttempt") long nextAttempt);
    /** 为全部日记新增或重置任务。 */
    int reindex();
}
