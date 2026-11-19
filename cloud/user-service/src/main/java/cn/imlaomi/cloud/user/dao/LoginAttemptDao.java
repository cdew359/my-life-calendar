package cn.imlaomi.cloud.user.dao;

import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

/** Redis 登录计数访问；是否拒绝登录由业务层根据策略决定。 */
@Repository
public class LoginAttemptDao {

    private final StringRedisTemplate redis;

    /** 注入 Redis 模板。 */
    public LoginAttemptDao(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** 原子增加计数并为首个请求设置一分钟过期时间。 */
    public Long increment(String sourceIp) {
        return redis.execute(
            new DefaultRedisScript<>(
                "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
                Long.class
            ),
            List.of(key(sourceIp))
        );
    }

    /** 成功认证后移除计数。 */
    public void reset(String sourceIp) {
        redis.delete(key(sourceIp));
    }

    /** 沿用已有 Redis 键格式。 */
    private static String key(String sourceIp) {
        return "calendar:cloud:login:" + Integer.toHexString(sourceIp.hashCode());
    }
}
