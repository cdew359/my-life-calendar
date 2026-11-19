package cn.imlaomi.cloud.calendar;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cn.imlaomi.cloud.calendar.client.UserClient;
import cn.imlaomi.cloud.calendar.dao.CalendarStateDao;
import cn.imlaomi.cloud.calendar.entity.CalendarStateEntity;
import cn.imlaomi.cloud.calendar.service.CalendarService;
import cn.imlaomi.cloud.calendar.util.CalendarJson;
import cn.imlaomi.cloud.common.dto.AccountSummary;
import java.util.List;
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
import org.springframework.transaction.annotation.EnableTransactionManagement;
import tools.jackson.databind.ObjectMapper;

@SpringJUnitConfig(CalendarTransactionTest.Config.class)
@TestPropertySource(
    properties = {
        "spring.datasource.url=jdbc:h2:mem:calendar;MODE=MySQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "mybatis.mapper-locations=classpath:mapper/*.xml",
        "mybatis.configuration.local-cache-scope=STATEMENT",
    }
)
class CalendarTransactionTest {

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement
    @MapperScan("cn.imlaomi.cloud.calendar.dao")
    @ImportAutoConfiguration({
        DataSourceAutoConfiguration.class,
        DataSourceTransactionManagerAutoConfiguration.class,
        MybatisAutoConfiguration.class,
    })
    static class Config {

        /** 测试仅替换远程账号服务，数据库和事务使用真实实现。 */
        @Bean
        UserClient users() {
            return mock(UserClient.class);
        }

        /** 将业务类交给 Spring 代理以验证事务是否实际生效。 */
        @Bean
        CalendarService service(CalendarStateDao dao, UserClient users) {
            return new CalendarService(
                dao,
                users,
                tools.jackson.databind.json.JsonMapper.builder().build()
            );
        }
    }

    @Autowired
    CalendarService service;

    @Autowired
    CalendarStateDao dao;

    @Autowired
    UserClient users;

    @Autowired
    DataSource dataSource;

    final ObjectMapper json = tools.jackson.databind.json.JsonMapper.builder().build();

    /** 建立日历文档及跨后端共享锁的测试表。 */
    @BeforeEach
    void schema() {
        var db = new JdbcTemplate(dataSource);
        db.execute("DROP TABLE IF EXISTS cloud_calendar_states");
        db.execute("DROP TABLE IF EXISTS cloud_calendar_lock");
        db.execute(
            "CREATE TABLE cloud_calendar_states(account_id VARCHAR(32) PRIMARY KEY,version BIGINT,payload CLOB)"
        );
        db.execute("CREATE TABLE cloud_calendar_lock(id INT PRIMARY KEY)");
        db.update("INSERT INTO cloud_calendar_lock VALUES(1)");
        when(users.accounts()).thenReturn(
            List.of(
                new AccountSummary("alice-id", "alice", null),
                new AccountSummary("bob-id", "bob", null)
            )
        );
    }

    /** 验证真实 XML、快照序列化及分享更新处于同一业务事务。 */
    @Test
    void savesAndDistributesShares() throws Exception {
        assertThat(AopUtils.isAopProxy(service)).isTrue();
        var upload = CalendarJson.upload(
            json.readTree(
                "{\"plans\":[{\"id\":\"p\",\"date\":\"2026-11-19\",\"text\":\"一起出发\",\"createdAt\":1,\"updatedAt\":2,\"shareWith\":[\"bob\"]}]}"
            )
        );
        var result = service.save("alice-id", upload);
        assertThat(dao.find("alice-id").version()).isEqualTo(result.version());
        assertThat(service.get("bob-id").data().plans())
            .extracting(p -> p.id())
            .containsExactly("p@alice");
        assertThat(service.get("bob-id").data().plans().get(0).sharedBy()).isEqualTo("alice");
        assertThat(service.get("bob-id").data().plans().get(0).shareWith()).isNull();
    }

    /** 分享接收方数据异常时，来源账号已经执行的写入也必须回滚。 */
    @Test
    void rollsBackOwnerWhenRecipientFails() throws Exception {
        dao.upsert(
            new CalendarStateEntity("alice-id", 7, CalendarJson.write(CalendarJson.read(null)))
        );
        dao.upsert(new CalendarStateEntity("bob-id", 8, "invalid-json"));
        assertThatThrownBy(() ->
            service.save("alice-id", CalendarJson.upload(json.createObjectNode()))
        ).isInstanceOf(IllegalStateException.class);
        assertThat(dao.find("alice-id").version()).isEqualTo(7);
        assertThat(dao.find("bob-id").version()).isEqualTo(8);
    }
}
