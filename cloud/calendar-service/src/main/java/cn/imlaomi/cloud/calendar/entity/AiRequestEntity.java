package cn.imlaomi.cloud.calendar.entity;

/** 审计仅保存指纹、用量和状态，不保存用户原文或模型正文。 */
public record AiRequestEntity(
    String accountId,
    String requestId,
    String fingerprint,
    String feature,
    String model,
    String status,
    Long createdAt
) {}
