package cn.imlaomi.cloud.user;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = { "cn.imlaomi.cloud.user", "cn.imlaomi.cloud.common" })
public class UserApplication {

    /** 启动当前 Spring Boot 服务并加载其运行配置。 */
    public static void main(String[] args) {
        SpringApplication.run(UserApplication.class, args);
    }
}
