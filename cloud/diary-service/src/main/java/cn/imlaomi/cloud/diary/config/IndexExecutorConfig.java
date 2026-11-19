package cn.imlaomi.cloud.diary.config;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 日记索引专用线程池；与接口线程隔离，避免在小内存服务器上无界创建线程或堆积任务。 */
@Configuration
public class IndexExecutorConfig {

    public static final int WORKER_COUNT = 2;

    /**
     * 手动创建线程池并交给 Spring 管理。两个线程处理数据库中的持久化任务，内存队列只暂存少量批次。
     * 使用 AbortPolicy 明确拒绝超量提交，由调度器保留数据库任务等待下次触发，不让调用线程代为执行。
     */
    @Bean(destroyMethod = "shutdown")
    public ThreadPoolExecutor diaryIndexExecutor() {
        AtomicInteger sequence = new AtomicInteger();
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
            WORKER_COUNT,
            WORKER_COUNT,
            30,
            TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(WORKER_COUNT),
            task -> {
                Thread thread = new Thread(task, "diary-index-" + sequence.incrementAndGet());
                thread.setDaemon(false);
                return thread;
            },
            new ThreadPoolExecutor.AbortPolicy()
        );
        executor.allowCoreThreadTimeOut(true);
        return executor;
    }
}
