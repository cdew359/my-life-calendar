package cn.imlaomi.cloud.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = { "cn.imlaomi.cloud.gateway" })
public class GatewayApplication {

    /** 启动当前 Spring Boot 服务并加载其运行配置。 */
    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }
}
