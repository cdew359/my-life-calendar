package cn.imlaomi.cloud.user.dto;

import java.util.List;

/** 无 Java 网关部署时供现有网页和客户端协商同步协议。 */
public record HealthResponse(boolean ok, String mode, List<String> capabilities) {}
