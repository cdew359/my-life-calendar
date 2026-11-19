package cn.imlaomi.cloud.common.dto;

/** 对客户端公开的统一错误响应，保持现有 error 字段。 */
public record ApiErrorResponse(String error) {}
