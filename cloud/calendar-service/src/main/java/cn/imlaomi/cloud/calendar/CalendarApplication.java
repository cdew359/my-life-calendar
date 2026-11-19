package cn.imlaomi.cloud.calendar;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.openfeign.EnableFeignClients;

@SpringBootApplication(
    scanBasePackages = { "cn.imlaomi.cloud.calendar", "cn.imlaomi.cloud.common" }
)
@EnableFeignClients
@org.springframework.scheduling.annotation.EnableScheduling
public class CalendarApplication {

    /** 启动当前 Spring Boot 服务并加载其运行配置。 */
    public static void main(String[] args) {
        SpringApplication.run(CalendarApplication.class, args);
    }
}
