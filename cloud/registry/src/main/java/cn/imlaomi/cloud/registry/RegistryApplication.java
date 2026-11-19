package cn.imlaomi.cloud.registry;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.netflix.eureka.server.EnableEurekaServer;

@SpringBootApplication(scanBasePackages = { "cn.imlaomi.cloud.registry" })
@EnableEurekaServer
public class RegistryApplication {

    /** 启动当前 Spring Boot 服务并加载其运行配置。 */
    public static void main(String[] args) {
        SpringApplication.run(RegistryApplication.class, args);
    }
}
