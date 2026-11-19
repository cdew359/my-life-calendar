package cn.imlaomi.cloud.calendar.dao;

import cn.imlaomi.cloud.calendar.entity.CalendarStateEntity;
import org.apache.ibatis.annotations.*;

/** 日历状态与跨后端共享锁的数据访问。 */
@Mapper
public interface CalendarStateDao {
    /** 查询指定账号的快照，不存在时返回 null。 */
    CalendarStateEntity find(@Param("account") String account);
    /** 在调用方事务中获取 Node 与 Java 共用的全局日历锁。 */
    int lockCalendar();
    /** 新增或更新整个账号快照。 */
    int upsert(CalendarStateEntity state);
}
