package cn.imlaomi.cloud.gateway.dto;

import java.util.List;

/** 网关协议能力与当前运行模式。 */
public record HealthResponse(boolean ok, String mode, List<String> capabilities) {}
