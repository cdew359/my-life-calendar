package cn.imlaomi.cloud.calendar.dao;

import cn.imlaomi.cloud.calendar.entity.AiRequestEntity;
import org.apache.ibatis.annotations.*;

/** AI 请求审计与持久化幂等状态，所有查询都包含账号条件。 */
@Mapper
public interface AiRequestDao {
    /** 通过唯一键确保同账号同请求只会认领一次。 */
    int claim(AiRequestEntity request);
    /** 读取原请求，不允许其他账号重放。 */
    AiRequestEntity find(@Param("account") String account, @Param("request") String request);
    /** 完成请求，缺失用量保持 null，失败只保存稳定错误类型。 */
    int finish(
        @Param("account") String account,
        @Param("request") String request,
        @Param("status") String status,
        @Param("inputTokens") Integer inputTokens,
        @Param("outputTokens") Integer outputTokens,
        @Param("latency") long latency,
        @Param("finishedAt") long finishedAt
    );

    /** 分批清理三十天前的审计，不处理当前请求或任何日历日记业务数据。 */
    @Delete("DELETE FROM cloud_ai_requests WHERE created_at < #{cutoff} LIMIT 500")
    int deleteExpired(@Param("cutoff") long cutoff);

    /** 从已持久化请求恢复配额，未知和失败请求也保守计入。 */
    int countSince(@Param("account") String account, @Param("since") long since);
}
