package cn.imlaomi.cloud.user;

import static org.assertj.core.api.Assertions.*;

import cn.imlaomi.cloud.user.dao.AccountDao;
import cn.imlaomi.cloud.user.entity.AccountEntity;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.annotation.MapperScan;
import org.mybatis.spring.boot.autoconfigure.MybatisAutoConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.context.annotation.Configuration;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;

@SpringJUnitConfig(AccountDaoTest.Config.class)
@TestPropertySource(
    properties = {
        "spring.datasource.url=jdbc:h2:mem:accounts;MODE=MySQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "mybatis.mapper-locations=classpath:mapper/*.xml",
        "mybatis.configuration.local-cache-scope=STATEMENT",
    }
)
class AccountDaoTest {

    @Configuration(proxyBeanMethods = false)
    @MapperScan("cn.imlaomi.cloud.user.dao")
    @ImportAutoConfiguration({ DataSourceAutoConfiguration.class, MybatisAutoConfiguration.class })
    static class Config {}

    @Autowired
    AccountDao dao;

    @Autowired
    DataSource dataSource;

    /** 用 MySQL 兼容模式验证 XML 真实绑定，不启动外部服务。 */
    @BeforeEach
    void schema() {
        var db = new JdbcTemplate(dataSource);
        db.execute("DROP TABLE IF EXISTS cloud_accounts");
        db.execute(
            "CREATE TABLE cloud_accounts(id VARCHAR(32) PRIMARY KEY,username VARCHAR(24),username_key VARCHAR(24) UNIQUE,nickname VARCHAR(24),password_hash VARCHAR(100),created_at BIGINT)"
        );
    }

    /** 验证 record 构造映射、空昵称、账号唯一约束和注入文本的参数绑定。 */
    @Test
    void mapsRecordsAndBindsParameters() {
        var account = new AccountEntity("id", "Alice", "alice", null, "hash", 42);
        dao.insert(account);
        assertThat(dao.findByUsernameKey("alice")).isEqualTo(account);
        assertThat(dao.countById("id")).isEqualTo(1);
        assertThat(dao.findByUsernameKey("alice' OR '1'='1")).isNull();
        dao.updateNickname("id", "小米");
        assertThat(dao.findAll()).extracting(AccountEntity::nickname).containsExactly("小米");
        dao.updateNickname("id", null);
        assertThat(dao.findAll().get(0).nickname()).isNull();
        assertThatThrownBy(() ->
            dao.insert(new AccountEntity("id2", "Alice", "alice", null, "hash", 43))
        ).isInstanceOf(DuplicateKeyException.class);
    }
}
