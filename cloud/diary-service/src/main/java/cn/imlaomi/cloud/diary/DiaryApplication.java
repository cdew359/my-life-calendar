package cn.imlaomi.cloud.diary;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = { "cn.imlaomi.cloud.diary", "cn.imlaomi.cloud.common" })
@EnableFeignClients
@EnableScheduling
public class DiaryApplication {

    /** 启动当前 Spring Boot 服务并加载其运行配置。 */
    public static void main(String[] args) {
        SpringApplication.run(DiaryApplication.class, args);
    }
}
