package cn.imlaomi.cloud.diary;

import static org.assertj.core.api.Assertions.*;

import cn.imlaomi.cloud.common.exception.ApiException;
import cn.imlaomi.cloud.diary.dao.*;
import cn.imlaomi.cloud.diary.service.DiaryEntryService;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.annotation.MapperScan;
import org.mybatis.spring.boot.autoconfigure.MybatisAutoConfiguration;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.jdbc.autoconfigure.*;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;

@SpringJUnitConfig(DiaryTransactionTest.Config.class)
@TestPropertySource(
    properties = {
        "spring.datasource.url=jdbc:h2:mem:diaries;MODE=MySQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "mybatis.mapper-locations=classpath:mapper/*.xml",
        "mybatis.configuration.local-cache-scope=STATEMENT",
    }
)
class DiaryTransactionTest {

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement
    @MapperScan("cn.imlaomi.cloud.diary.dao")
    @ImportAutoConfiguration({
        DataSourceAutoConfiguration.class,
        DataSourceTransactionManagerAutoConfiguration.class,
        MybatisAutoConfiguration.class,
    })
    static class Config {

        /** 注册真实业务代理，验证 MyBatis 参与 Spring 事务。 */
        @Bean
        DiaryEntryService entries(DiaryEntryDao dao, DiaryOutboxDao outbox) {
            return new DiaryEntryService(dao, outbox);
        }
    }

    @Autowired
    DiaryEntryService entries;

    @Autowired
    DiaryOutboxDao outbox;

    @Autowired
    DataSource dataSource;

    @Autowired
    PlatformTransactionManager manager;

    /** 建立与业务 SQL 相同字段和唯一约束的轻量测试表。 */
    @BeforeEach
    void schema() {
        var db = new JdbcTemplate(dataSource);
        db.execute("DROP TABLE IF EXISTS cloud_diary_entries");
        db.execute("DROP TABLE IF EXISTS cloud_diary_outbox");
        db.execute(
            "CREATE TABLE cloud_diary_entries(account_id VARCHAR(32),diary_date VARCHAR(10),title VARCHAR(100),content CLOB,revision INT,created_at BIGINT,updated_at BIGINT,deleted BOOLEAN,PRIMARY KEY(account_id,diary_date))"
        );
        db.execute(
            "CREATE TABLE cloud_diary_outbox(id BIGINT AUTO_INCREMENT PRIMARY KEY,account_id VARCHAR(32),diary_date VARCHAR(10),attempts INT DEFAULT 0,next_attempt BIGINT DEFAULT 0,UNIQUE(account_id,diary_date))"
        );
    }

    /** 验证新增、旧版本冲突、软删除、账号隔离及 outbox 更新构成完整链路。 */
    @Test
    void savesVersionsAndEnqueuesAtomically() {
        assertThat(AopUtils.isAopProxy(entries)).isTrue();
        var saved = entries.write("alice", "2026-11-19", "title", "body", 0, false);
        assertThat(saved.revision()).isEqualTo(1);
        assertThat(entries.get("bob", "2026-11-19")).isNull();
        assertThatThrownBy(() ->
            entries.write("alice", "2026-11-19", "old", "old", 0, false)
        ).isInstanceOf(ApiException.class);
        assertThat(entries.get("alice", "2026-11-19").title()).isEqualTo("title");
        var deleted = entries.write("alice", "2026-11-19", "", "", 1, true);
        assertThat(deleted.revision()).isEqualTo(2);
        assertThat(deleted.deleted()).isTrue();
        assertThat(deleted.content()).isEqualTo("body");
        new TransactionTemplate(manager).executeWithoutResult(status -> {
            var jobs = outbox.claim(System.currentTimeMillis());
            assertThat(jobs).hasSize(1);
            assertThat(jobs.get(0).accountId()).isEqualTo("alice");
            outbox.defer(jobs.get(0).id(), System.currentTimeMillis() + 60000);
            assertThat(outbox.claim(System.currentTimeMillis())).isEmpty();
            outbox.enqueue("alice", "2026-11-19");
            assertThat(outbox.claim(System.currentTimeMillis()).get(0).attempts()).isZero();
            outbox.delete(jobs.get(0).id());
            assertThat(outbox.claim(System.currentTimeMillis())).isEmpty();
        });
        outbox.reindex();
        assertThat(
            new JdbcTemplate(dataSource).queryForObject(
                "SELECT COUNT(*) FROM cloud_diary_outbox",
                Integer.class
            )
        ).isEqualTo(1);
    }

    /** 索引任务写入失败必须回滚正文更新，包括首次写入的占位行。 */
    @Test
    void rollsBackDiaryWhenOutboxFails() {
        entries.write("alice", "2026-11-19", "original", "body", 0, false);
        new JdbcTemplate(dataSource).execute("DROP TABLE cloud_diary_outbox");
        assertThatThrownBy(() ->
            entries.write("alice", "2026-11-19", "changed", "body", 1, false)
        ).isInstanceOf(RuntimeException.class);
        assertThat(entries.get("alice", "2026-11-19").revision()).isEqualTo(1);
        assertThat(entries.get("alice", "2026-11-19").title()).isEqualTo("original");
        assertThatThrownBy(() ->
            entries.write("bob", "2026-11-19", "new", "body", 0, false)
        ).isInstanceOf(RuntimeException.class);
        assertThat(entries.get("bob", "2026-11-19")).isNull();
    }
}
