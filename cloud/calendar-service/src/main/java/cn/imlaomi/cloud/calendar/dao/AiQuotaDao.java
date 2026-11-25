package cn.imlaomi.cloud.calendar.dao;

import cn.imlaomi.cloud.common.exception.ApiException;
import java.time.*;
import java.util.List;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

/**
 * AI 请求的 Redis 数据访问：全站并发租约、按北京时间切日的配额、按账号隔离的结果缓存。
 * 请求认领和长期终态由 MySQL 审计保存，本类不负责执行模型业务。
 */
@Repository
public class AiQuotaDao {

    private final StringRedisTemplate redis;
    private final AiRequestDao audit;

    /** 注入 Redis 和配额恢复所需的审计查询。 */
    public AiQuotaDao(StringRedisTemplate redis, AiRequestDao audit) {
        this.redis = redis;
        this.audit = audit;
    }

    /**
     * 尝试取得全站共享的单个在途名额，使用 SET NX 与90秒过期租约。
     *
     * <p>租约自动过期用于故障恢复，不会主动终止还在运行的 HTTP 请求；
     * 它不是永久锁，也不构成严格的模型请求端到端超时保证。
     *
     * @return 本请求的随机租约令牌，用于结束时仅释放自己持有的名额
     * @throws ApiException 名额已占用时返回 429
     */
    public String acquire() {
        String token = UUID.randomUUID().toString();
        if (
            !Boolean.TRUE.equals(
                redis.opsForValue().setIfAbsent("calendar:ai:slot", token, Duration.ofSeconds(90))
            )
        ) throw new ApiException(429, "AI 正在处理其他请求，请稍后再试");
        return token;
    }

    /**
     * 通过 Lua 原子比较令牌并删除名额，避免租约过期后旧请求误删下一请求的新租约。
     * 不能用分开的 GET 和 DEL，否则比较与删除之间可能被另一请求接管。
     *
     * @param token acquire 返回的本请求令牌，不是账号登录 token
     */
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

    /**
     * 预留当前账号及全站的当日次数，Lua 确保两者检查和递增不可被并发请求拆开。
     *
     * <p>键包含北京时间日期，并在次日零点附近过期。Redis 键不存在时，先用 MySQL
     * 当日审计数量恢复，再减去本次已认领但尚未预留的记录，避免将当前请求重复计入。
     * 已失败或未实际调用模型的认领记录也可能计入恢复值，因此是保守上限而非账单。
     *
     * @param account 当前已验证账号，账号键与 global 键使用不同前缀
     * @param accountLimit 单账号每日次数上限
     * @param globalLimit 全站每日次数上限
     * @throws ApiException 任一上限已达到或 Lua 未返回允许标记时返回 429
     */
    public void reserve(String account, int accountLimit, int globalLimit) {
        ZoneId zone = ZoneId.of("Asia/Shanghai");
        LocalDate today = LocalDate.now(zone);
        long start = today.atStartOfDay(zone).toInstant().toEpochMilli();
        //计算当前时间到明天0点还有多少秒
        long ttl = Math.max(
            1,
            Duration.between(
                Instant.now(),
                today.plusDays(1).atStartOfDay(zone).toInstant()
            ).toSeconds()
        );
        //为每天、每个账号生成独立的 Redis Key。
        String prefix = "calendar:ai:quota:" + today + ":";
        Long allowed = redis.execute(
            new DefaultRedisScript<>(
                "if redis.call('EXISTS',KEYS[1])==0 then redis.call('SET',KEYS[1],ARGV[4],'EX',ARGV[3]) end; " +
                    "if redis.call('EXISTS',KEYS[2])==0 then redis.call('SET',KEYS[2],ARGV[5],'EX',ARGV[3]) end; " +
                    "if tonumber(redis.call('GET',KEYS[1]))>=tonumber(ARGV[1]) or tonumber(redis.call('GET',KEYS[2]))>=tonumber(ARGV[2]) then return 0 end; " +
                    "redis.call('INCR',KEYS[1]); redis.call('INCR',KEYS[2]); return 1",
                Long.class
            ),
            //当前账号今天已使用的次数。全站所有账号今天已使用的总次数。
            List.of(prefix + "account:" + account, prefix + "global"),
            Integer.toString(accountLimit),
            Integer.toString(globalLimit),
            Long.toString(ttl),
            //数据库中回复的兜底数据
            Integer.toString(Math.max(0, audit.countSince(account, start) - 1)),
            Integer.toString(Math.max(0, audit.countSince(null, start) - 1))
        );
        if (!Long.valueOf(1).equals(allowed)) throw new ApiException(
            429,
            "今日 AI 次数已用完，仍可手动录入和搜索"
        );
    }

    /**
     * 按账号和请求 UUID 读取结果正文；不存在或已过十分钟时返回 null。
     * 读取缓存本身不代表请求成功，AiRequestService 先检查数据库终态才调用此方法。
     */
    public String cached(String account, String request) {
        return redis.opsForValue().get("calendar:ai:result:" + account + ":" + request);
    }

    /**
     * 缓存结构化响应 JSON 十分钟，避免相同成功请求再次调用模型。
     * 可能包含个人日记片段，应仅存于受控私网 Redis；数据库审计不保存这些正文。
     */
    public void cache(String account, String request, String result) {
        redis
            .opsForValue()
            .set("calendar:ai:result:" + account + ":" + request, result, Duration.ofMinutes(10));
    }
}
