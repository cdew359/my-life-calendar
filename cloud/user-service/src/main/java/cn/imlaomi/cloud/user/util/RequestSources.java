package cn.imlaomi.cloud.user.util;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Optional;

/** 读取边缘代理已覆盖的来源 IP。 */
public final class RequestSources {

    /** 使用可信代理头；本地无代理时回退到连接地址。 */
    public static String ip(HttpServletRequest request) {
        return Optional.ofNullable(request.getHeader("X-Real-IP")).orElse(request.getRemoteAddr());
    }
}
