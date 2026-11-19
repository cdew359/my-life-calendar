package cn.imlaomi.cloud.gateway.controller;

import cn.imlaomi.cloud.gateway.dto.HealthResponse;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

@RestController
public class HealthController {

    @Value("${CLOUD_DATA_MODE:trial}")
    String mode;

    /** 返回当前数据模式及客户端可用的协议能力。 */
    @GetMapping("/api/health")
    HealthResponse health() {
        List<String> capabilities = new ArrayList<>(
            List.of(
                "timelines-v1",
                "timelines-backward-v1",
                "timelines-goal-v1",
                "diary-v1",
                "birthday-reminders-v1"
            )
        );
        if (mode.equals("shared")) capabilities.add("shared-data-v1");
        return new HealthResponse(
            true,
            mode.equals("shared") ? "spring-cloud-shared" : "spring-cloud-trial",
            capabilities
        );
    }
}
