package cn.imlaomi.cloud.diary.service;

import cn.imlaomi.cloud.diary.config.IndexExecutorConfig;
import cn.imlaomi.cloud.diary.dao.DiaryOutboxDao;
import cn.imlaomi.cloud.diary.dao.DiarySearchDao;
import cn.imlaomi.cloud.diary.entity.DiaryOutboxJob;
import jakarta.annotation.PreDestroy;
import java.util.*;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class IndexWorker {

    private static final Logger LOG = LoggerFactory.getLogger(IndexWorker.class);
    private final DiaryOutboxDao outboxDao;
    private final DiaryEntryService entryService;
    private final DiarySearchDao searchDao;
    private final TransactionTemplate tx;
    private final ThreadPoolExecutor executor;
    // 同时在途的批次最多两个，防止慢请求跨过下一轮定时触发后不断排队。
    private final Semaphore batches = new Semaphore(IndexExecutorConfig.WORKER_COUNT);
    private final AtomicBoolean stopping = new AtomicBoolean();

    /** 注入日记存储、索引客户端、事务工具及专用线程池；不在请求线程中执行索引更新。 */
    public IndexWorker(
        DiaryOutboxDao outboxDao,
        DiaryEntryService entryService,
        DiarySearchDao searchDao,
        TransactionTemplate tx,
        @Qualifier("diaryIndexExecutor") ThreadPoolExecutor executor
    ) {
        this.outboxDao = outboxDao;
        this.entryService = entryService;
        this.searchDao = searchDao;
        this.tx = tx;
        this.executor = executor;
    }

    /** 只向线程池提交空闲批次，实际待办保留在数据库；停机或线程池拒绝时等下轮再处理。 */
    @Scheduled(fixedDelay = 3000, initialDelay = 3000)
    public void tick() {
        for (int n = 0; n < IndexExecutorConfig.WORKER_COUNT; n++) {
            if (stopping.get() || !batches.tryAcquire()) return;
            try {
                executor.execute(this::processBatch);
            } catch (RejectedExecutionException rejected) {
                batches.release();
                return;
            }
        }
    }

    /** 在工作线程中执行有限批次，异常退出后释放名额，数据库任务仍可被下一轮重新认领。 */
    private void processBatch() {
        try {
            if (stopping.get()) return;
            if (searchDao.ensure()) reindex();
            for (
                int n = 0;
                n < 5 && !stopping.get() && !Thread.currentThread().isInterrupted();
                n++
            ) {
                // Spring 事务绑定当前线程：必须在工作线程内创建事务，不能把调度线程的连接传进来。
                if (!Boolean.TRUE.equals(tx.execute(status -> processOne()))) break;
            }
        } catch (RuntimeException failure) {
            LOG.debug("Diary indexing deferred ({})", failure.getClass().getSimpleName());
        } finally {
            batches.release();
        }
    }

    /** 在当前事务中锁定一条到期任务，成功后删除；ES 失败时保存退避重试，中断时回滚认领。 */
    private boolean processOne() {
        var jobs = outboxDao.claim(System.currentTimeMillis());
        if (jobs.isEmpty()) return false;
        var job = jobs.get(0);
        String account = job.accountId(),
            date = job.date();
        var entry = entryService.get(account, date);
        try {
            if (entry != null) searchDao.put(account, entry);
            outboxDao.delete(job.id());
        } catch (RuntimeException failure) {
            if (Thread.currentThread().isInterrupted()) throw failure;
            int attempts = job.attempts();
            outboxDao.defer(
                job.id(),
                System.currentTimeMillis() + Math.min(60000, 2000L * (1L << Math.min(attempts, 5)))
            );
        }
        return true;
    }

    /** 为所有日记新增或重置 outbox 任务，供后台逐条重建搜索索引。 */
    public int reindex() {
        return outboxDao.reindex();
    }

    /** 停止新批次并等待已认领任务提交；超时或关闭线程被中断时中断工作线程，未完成任务仍留在数据库。 */
    @PreDestroy
    public void stop() {
        if (!stopping.compareAndSet(false, true)) return;
        executor.shutdown();
        try {
            if (!executor.awaitTermination(15, TimeUnit.SECONDS)) {
                executor.shutdownNow();
                if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
                    LOG.warn(
                        "Diary index workers have not terminated; unfinished jobs remain in the outbox"
                    );
                }
            }
        } catch (InterruptedException interrupted) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
