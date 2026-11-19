package cn.imlaomi.cloud.calendar.service;

import cn.imlaomi.cloud.calendar.dao.AiRequestDao;
import java.time.Duration;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 复用 Spring 调度器分批清理审计，正文缓存由 Redis 十分钟自动过期。 */
@Component
public class AiAuditCleanup {

    private final AiRequestDao audit;

    /** 注入仅访问 AI 元数据表的数据访问层。 */
    public AiAuditCleanup(AiRequestDao audit) {
        this.audit = audit;
    }

    /** 每小时最多删除五百条，避免在低内存服务器上执行大批量事务。 */
    @Scheduled(initialDelay = 3600000, fixedDelay = 3600000)
    public void clean() {
        audit.deleteExpired(System.currentTimeMillis() - Duration.ofDays(30).toMillis());
    }
}
