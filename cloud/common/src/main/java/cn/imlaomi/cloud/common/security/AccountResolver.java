package cn.imlaomi.cloud.common.security;

@FunctionalInterface
public interface AccountResolver {
    /** 判断令牌对应的账号是否存在，供受保护 API 的鉴权流程使用。 */
    boolean exists(String accountId);
}
