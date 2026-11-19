package cn.imlaomi.cloud.common.dto;

/** 服务间传递的账号公开资料，不包含密码哈希或登录凭据。 */
public record AccountSummary(String id, String username, String nickname) {}
