package cn.imlaomi.cloud.user.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;

/** 账号表记录，仅供持久化及业务层使用，不能作为公开接口响应。 */
public record AccountEntity(
    String id,
    String username,
    String usernameKey,
    String nickname,
    @JsonIgnore String passwordHash,
    long createdAt
) {
    /** 防止密码哈希被对象日志记录。 */
    @Override
    public String toString() {
        return "AccountEntity[credentials redacted]";
    }
}
