package cn.imlaomi.cloud.diary.dao;

import cn.imlaomi.cloud.diary.entity.DiaryEntryEntity;
import org.apache.ibatis.annotations.*;

/** 日记行访问，锁定读与普通读使用独立声明。 */
@Mapper
public interface DiaryEntryDao {
    /** 读取当前账号某天日记。 */
    DiaryEntryEntity find(@Param("account") String account, @Param("date") String date);
    /** 在业务事务内锁定日记版本。 */
    DiaryEntryEntity findForUpdate(@Param("account") String account, @Param("date") String date);
    /** 取得唯一键排他锁；无记录时创建占位行。 */
    int ensureRow(
        @Param("account") String account,
        @Param("date") String date,
        @Param("now") long now
    );
    /** 更新经过业务校验的日记记录。 */
    int update(@Param("account") String account, @Param("entry") DiaryEntryEntity entry);
}
