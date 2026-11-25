package cn.imlaomi.cloud.user.controller;

import cn.imlaomi.cloud.user.dto.HealthResponse;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Nginx 接管路由后，继续提供客户端使用的协议能力接口。 */
@RestController
public class HealthController {

    private final String mode;

    /** 读取实际数据模式，避免将独立试验库标记为正式共享库。 */
    public HealthController(@Value("${CLOUD_DATA_MODE:trial}") String mode) {
        this.mode = mode;
    }

    /** 返回与原网关一致的同步能力，不进行模型调用。 */
    @GetMapping("/api/health")
    public HealthResponse health() {
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
            List.copyOf(capabilities)
        );
    }
}
