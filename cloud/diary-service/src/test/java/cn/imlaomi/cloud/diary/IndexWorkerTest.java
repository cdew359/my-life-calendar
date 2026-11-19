package cn.imlaomi.cloud.diary;

import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import cn.imlaomi.cloud.diary.config.IndexExecutorConfig;
import cn.imlaomi.cloud.diary.dao.DiaryOutboxDao;
import cn.imlaomi.cloud.diary.dao.DiarySearchDao;
import cn.imlaomi.cloud.diary.entity.DiaryEntryEntity;
import cn.imlaomi.cloud.diary.entity.DiaryOutboxJob;
import cn.imlaomi.cloud.diary.service.DiaryEntryService;
import cn.imlaomi.cloud.diary.service.IndexWorker;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

class IndexWorkerTest {

    /** 验证并发上限和有界队列，超量任务必须拒绝，不能由调用线程代跑。 */
    @Test
    void boundsThreadsAndRejectsOverflow() throws Exception {
        var pool = new IndexExecutorConfig().diaryIndexExecutor();
        var started = new CountDownLatch(2);
        var release = new CountDownLatch(1);
        Runnable blocked = () -> {
            assertThat(Thread.currentThread().getName()).startsWith("diary-index-");
            started.countDown();
            waitFor(release);
        };
        try {
            pool.execute(blocked);
            pool.execute(blocked);
            assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
            pool.execute(blocked);
            pool.execute(blocked);
            assertThatThrownBy(() -> pool.execute(blocked)).isInstanceOf(
                RejectedExecutionException.class
            );
            assertThat(pool.getLargestPoolSize()).isEqualTo(2);
        } finally {
            release.countDown();
            pool.shutdown();
            if (!pool.awaitTermination(5, TimeUnit.SECONDS)) pool.shutdownNow();
            assertThat(pool.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    /** 验证两个工作线程各自开启事务，重复定时触发不会堆积批次。 */
    @Test
    void runsConcurrentTransactionsWithoutAccumulatingBatches() throws Exception {
        try (var fixture = new Fixture(2)) {
            var started = new CountDownLatch(2);
            var release = new CountDownLatch(1);
            doAnswer(call -> {
                assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
                assertThat(Thread.currentThread().getName()).startsWith("diary-index-");
                started.countDown();
                waitFor(release);
                return null;
            })
                .when(fixture.index)
                .put(anyString(), any(DiaryEntryEntity.class));
            try {
                fixture.worker.tick();
                assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
                for (int n = 0; n < 20; n++) fixture.worker.tick();
                assertThat(fixture.pool.getQueue()).isEmpty();
                assertThat(fixture.claims.get()).isEqualTo(2);
            } finally {
                release.countDown();
            }
            await()
                .atMost(Duration.ofSeconds(5))
                .untilAsserted(() -> verify(fixture.db, times(2)).delete(anyLong()));
        }
    }

    /** 验证索引失败保留数据库任务并退避，后续批次仍可成功处理。 */
    @Test
    void retriesFailedIndexingAndReusesWorkerSlots() {
        try (var fixture = new Fixture(1)) {
            doThrow(new IllegalStateException("ES unavailable"))
                .doNothing()
                .when(fixture.index)
                .put(anyString(), any(DiaryEntryEntity.class));
            long before = System.currentTimeMillis();
            fixture.worker.tick();
            await()
                .atMost(Duration.ofSeconds(5))
                .until(() -> fixture.pool.getCompletedTaskCount() == 2);
            verify(fixture.db).defer(
                eq(1L),
                longThat(
                    value -> value >= before + 2000 && value <= System.currentTimeMillis() + 2000
                )
            );
            verify(fixture.db, never()).delete(anyLong());
            fixture.claims.set(0);
            fixture.remaining.set(1); // 模拟退避时间到期，数据库再次返回这条任务。
            fixture.worker.tick();
            await()
                .atMost(Duration.ofSeconds(5))
                .untilAsserted(() -> verify(fixture.db).delete(1L));
        }
    }

    /** 验证认领失败会回滚事务并释放批次名额，下一轮可正常继续。 */
    @Test
    void rollsBackClaimFailuresAndRecovers() {
        try (var fixture = new Fixture(1)) {
            var failures = new AtomicInteger(2);
            doAnswer(call -> {
                if (failures.getAndDecrement() > 0) throw new IllegalStateException(
                    "database unavailable"
                );
                return fixture.claim();
            })
                .when(fixture.db)
                .claim(anyLong());
            fixture.worker.tick();
            await()
                .atMost(Duration.ofSeconds(5))
                .until(() -> fixture.pool.getCompletedTaskCount() == 2);
            assertThat(fixture.transactions.rollbacks.get()).isEqualTo(2);
            fixture.worker.tick();
            await()
                .atMost(Duration.ofSeconds(5))
                .untilAsserted(() -> verify(fixture.db).delete(1L));
        }
    }

    /** 验证拒绝提交后归还名额，线程池恢复空闲时可以继续认领数据库任务。 */
    @Test
    void recoversAfterSubmissionRejection() throws Exception {
        try (var fixture = new Fixture(1)) {
            var started = new CountDownLatch(2);
            var release = new CountDownLatch(1);
            Runnable blocked = () -> {
                started.countDown();
                waitFor(release);
            };
            try {
                fixture.pool.execute(blocked);
                fixture.pool.execute(blocked);
                assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
                fixture.pool.execute(blocked);
                fixture.pool.execute(blocked);
                fixture.worker.tick();
                verifyNoInteractions(fixture.db);
            } finally {
                release.countDown();
            }
            await()
                .atMost(Duration.ofSeconds(5))
                .until(() -> fixture.pool.getCompletedTaskCount() == 4);
            fixture.worker.tick();
            await()
                .atMost(Duration.ofSeconds(5))
                .untilAsserted(() -> verify(fixture.db).delete(1L));
        }
    }

    /** 验证强制关闭中断正在执行的索引时回滚事务，不会删除或推迟未完成任务。 */
    @Test
    void rollsBackInterruptedJobDuringForcedShutdown() throws Exception {
        try (var fixture = new Fixture(1)) {
            var started = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            doAnswer(call -> {
                started.countDown();
                waitFor(release);
                return null;
            })
                .when(fixture.index)
                .put(anyString(), any(DiaryEntryEntity.class));
            try {
                fixture.worker.tick();
                assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
                var interruptPreserved = new AtomicBoolean();
                Thread closer = new Thread(() -> {
                    Thread.currentThread().interrupt();
                    fixture.worker.stop();
                    interruptPreserved.set(Thread.currentThread().isInterrupted());
                }, "test-interrupted-shutdown");
                closer.start();
                closer.join(5000);
                assertThat(closer.isAlive()).isFalse();
                assertThat(interruptPreserved.get()).isTrue();
                assertThat(fixture.pool.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
                assertThat(fixture.transactions.rollbacks.get()).isEqualTo(1);
                verify(fixture.db, never()).delete(anyLong());
                verify(fixture.db, never()).defer(anyLong(), anyLong());
            } finally {
                release.countDown();
            }
        }
    }

    /** 验证正常关闭等待当前任务提交，并停止接受后续批次。 */
    @Test
    void waitsForCurrentJobDuringShutdown() throws Exception {
        try (var fixture = new Fixture(1)) {
            var started = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            doAnswer(call -> {
                started.countDown();
                waitFor(release);
                return null;
            })
                .when(fixture.index)
                .put(anyString(), any(DiaryEntryEntity.class));
            Thread closer = new Thread(fixture.worker::stop, "test-index-shutdown");
            try {
                fixture.worker.tick();
                assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
                closer.start();
                await().atMost(Duration.ofSeconds(5)).until(fixture.pool::isShutdown);
                fixture.worker.tick();
                assertThat(closer.isAlive()).isTrue();
            } finally {
                release.countDown();
                closer.join(5000);
            }
            assertThat(closer.isAlive()).isFalse();
            assertThat(fixture.pool.isTerminated()).isTrue();
            verify(fixture.db).delete(1L);
        }
    }

    /** 有限等待测试闩锁，中断时保留标志并结束当前任务。 */
    private static void waitFor(CountDownLatch latch) {
        try {
            assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
    }

    private static class Fixture implements AutoCloseable {

        final DiaryOutboxDao db = mock(DiaryOutboxDao.class);
        final DiaryEntryService store = mock(DiaryEntryService.class);
        final DiarySearchDao index = mock(DiarySearchDao.class);
        final ThreadPoolExecutor pool = new IndexExecutorConfig().diaryIndexExecutor();
        final RecordingTransactions transactions = new RecordingTransactions();
        final IndexWorker worker = new IndexWorker(
            db,
            store,
            index,
            new TransactionTemplate(transactions),
            pool
        );
        final AtomicInteger remaining;
        final AtomicInteger claims = new AtomicInteger();

        /** 构造不依赖数据库或 ES 的线程池测试环境。 */
        Fixture(int jobs) {
            remaining = new AtomicInteger(jobs);
            when(db.claim(anyLong())).thenAnswer(call -> claim());
            when(store.get(anyString(), anyString())).thenReturn(
                new DiaryEntryEntity("2026-10-19", "title", "content", 1, 1, 1, false)
            );
        }

        /** 模拟数据库逐条认领，检查事务确实绑定当前工作线程。 */
        List<DiaryOutboxJob> claim() {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            if (remaining.getAndDecrement() <= 0) return List.of();
            long id = claims.incrementAndGet();
            return List.of(new DiaryOutboxJob(id, "owner", "2026-10-19", 0));
        }

        /** 每个测试结束时关闭非守护线程，避免测试进程泄漏。 */
        @Override
        public void close() {
            worker.stop();
        }
    }

    private static class RecordingTransactions extends AbstractPlatformTransactionManager {

        final AtomicInteger rollbacks = new AtomicInteger();

        /** 为每次事务创建独立上下文，由 Spring 管理线程绑定。 */
        @Override
        protected Object doGetTransaction() {
            return new Object();
        }

        /** 无外部数据库资源，事务同步上下文由父类建立。 */
        @Override
        protected void doBegin(Object transaction, TransactionDefinition definition) {}

        /** 测试事务提交时无需释放真实数据库连接。 */
        @Override
        protected void doCommit(DefaultTransactionStatus status) {}

        /** 记录回滚次数以验证任务异常的事务边界。 */
        @Override
        protected void doRollback(DefaultTransactionStatus status) {
            rollbacks.incrementAndGet();
        }
    }
}
