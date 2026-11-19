package cn.imlaomi.cloud.calendar.dao;

import cn.imlaomi.cloud.common.exception.ApiException;
import java.time.*;
import java.util.List;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

/** Redis 保存短期结果及原子配额；数据库保存幂等终态。 */
@Repository
public class AiQuotaDao {

    private final StringRedisTemplate redis;
    private final AiRequestDao audit;

    /** 注入 Redis 和配额恢复所需的审计查询。 */
    public AiQuotaDao(StringRedisTemplate redis, AiRequestDao audit) {
        this.redis = redis;
        this.audit = audit;
    }

    /** 限制全站一个在途请求，过期时间大于底层 HTTP 总超时。 */
    public String acquire() {
        String token = UUID.randomUUID().toString();
        if (
            !Boolean.TRUE.equals(
                redis.opsForValue().setIfAbsent("calendar:ai:slot", token, Duration.ofSeconds(90))
            )
        ) throw new ApiException(429, "AI 正在处理其他请求，请稍后再试");
        return token;
    }

    /** 只释放自己持有的名额，不误删下一条请求的租约。 */
    public void release(String token) {
        redis.execute(
            new DefaultRedisScript<>(
                "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
                Long.class
            ),
            List.of("calendar:ai:slot"),
            token
        );
    }

    /** 北京时间切日，Redis 重启后先恢复数据库计数再执行原子增量。 */
    public void reserve(String account, int accountLimit, int globalLimit) {
        ZoneId zone = ZoneId.of("Asia/Shanghai");
        LocalDate today = LocalDate.now(zone);
        long start = today.atStartOfDay(zone).toInstant().toEpochMilli();
        long ttl = Math.max(
            1,
            Duration.between(
                Instant.now(),
                today.plusDays(1).atStartOfDay(zone).toInstant()
            ).toSeconds()
        );
        String prefix = "calendar:ai:quota:" + today + ":";
        Long allowed = redis.execute(
            new DefaultRedisScript<>(
                "if redis.call('EXISTS',KEYS[1])==0 then redis.call('SET',KEYS[1],ARGV[4],'EX',ARGV[3]) end; if redis.call('EXISTS',KEYS[2])==0 then redis.call('SET',KEYS[2],ARGV[5],'EX',ARGV[3]) end; if tonumber(redis.call('GET',KEYS[1]))>=tonumber(ARGV[1]) or tonumber(redis.call('GET',KEYS[2]))>=tonumber(ARGV[2]) then return 0 end; redis.call('INCR',KEYS[1]); redis.call('INCR',KEYS[2]); return 1",
                Long.class
            ),
            List.of(prefix + "account:" + account, prefix + "global"),
            Integer.toString(accountLimit),
            Integer.toString(globalLimit),
            Long.toString(ttl),
            Integer.toString(Math.max(0, audit.countSince(account, start) - 1)),
            Integer.toString(Math.max(0, audit.countSince(null, start) - 1))
        );
        if (!Long.valueOf(1).equals(allowed)) throw new ApiException(
            429,
            "今日 AI 次数已用完，仍可手动录入和搜索"
        );
    }

    /** 读取当前账号的短期结果。 */
    public String cached(String account, String request) {
        return redis.opsForValue().get("calendar:ai:result:" + account + ":" + request);
    }

    /** 缓存草稿与回答十分钟，不将正文保存到审计表。 */
    public void cache(String account, String request, String result) {
        redis
            .opsForValue()
            .set("calendar:ai:result:" + account + ":" + request, result, Duration.ofMinutes(10));
    }
}
