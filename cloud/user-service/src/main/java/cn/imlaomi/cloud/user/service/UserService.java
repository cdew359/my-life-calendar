package cn.imlaomi.cloud.user.service;

import cn.imlaomi.cloud.common.dto.AccountExistsResponse;
import cn.imlaomi.cloud.common.dto.AccountSummary;
import cn.imlaomi.cloud.common.exception.ApiException;
import cn.imlaomi.cloud.common.util.Tokens;
import cn.imlaomi.cloud.user.config.LoginPolicy;
import cn.imlaomi.cloud.user.dao.AccountDao;
import cn.imlaomi.cloud.user.dao.LoginAttemptDao;
import cn.imlaomi.cloud.user.dto.UserDtos.*;
import cn.imlaomi.cloud.user.entity.AccountEntity;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class UserService {

    private final AccountDao accountDao;
    private final Tokens tokens;
    private final LoginAttemptDao loginAttemptDao;
    private final String code, internalKey;
    private final int days;
    private final LoginPolicy loginPolicy;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder(10);
    private final String dummyHash = passwords.encode("constant-time-invalid-account");

    /** 注入账号存储、令牌、Redis 限流和可热更新的登录策略。 */
    public UserService(
        AccountDao accountDao,
        Tokens tokens,
        LoginAttemptDao loginAttemptDao,
        @Value("${cloud.register-code}") String code,
        @Value("${cloud.internal-key}") String key,
        @Value("${cloud.token-days}") int days,
        LoginPolicy loginPolicy
    ) {
        this.accountDao = accountDao;
        this.tokens = tokens;
        this.loginAttemptDao = loginAttemptDao;
        this.code = code;
        this.internalKey = key;
        this.days = days;
        this.loginPolicy = loginPolicy;
    }

    /** 按可信代理提供的来源 IP 计数，超过每分钟尝试上限时拒绝请求。 */
    void rate(String sourceIp) {
        Long count = loginAttemptDao.increment(sourceIp);
        if (count == null || count > loginPolicy.maxAttempts()) throw new ApiException(
            429,
            "尝试过于频繁，请稍后再试"
        );
    }

    /** 登录或注册成功后清除该来源 IP 的尝试计数。 */
    void reset(String sourceIp) {
        loginAttemptDao.reset(sourceIp);
    }

    /** 校验账号密码，兼容旧密码哈希，并签发当前账号的登录令牌。 */

    public AuthResponse login(LoginRequest body, String sourceIp) {
        rate(sourceIp);
        String username = body.username().trim(),
            password = body.password();
        if (password.length() > 64) throw new ApiException(401, "账号或密码错误");
        AccountEntity user = accountDao.findByUsernameKey(username.toLowerCase(Locale.ROOT));
        boolean valid = passwords.matches(password, user == null ? dummyHash : user.passwordHash());
        if (user == null || !valid || password.isEmpty()) throw new ApiException(
            401,
            "账号或密码错误"
        );
        reset(sourceIp);
        return new AuthResponse(tokens.issue(user.id(), days), user.username());
    }

    /** 校验注册码、账号名和密码长度后创建账号，并返回登录令牌。 */

    public AuthResponse register(RegisterRequest body, String sourceIp) {
        rate(sourceIp);
        String username = body.username().trim(),
            password = body.password(),
            nickname = body.nickname().trim();
        if (
            !MessageDigest.isEqual(
                code.getBytes(StandardCharsets.UTF_8),
                body.code().getBytes(StandardCharsets.UTF_8)
            )
        ) throw new ApiException(403, "注册码不正确");
        if (!username.matches("[\\p{L}\\p{N}_-]{2,24}")) throw new ApiException(
            400,
            "账号需 2–24 位，可用中文、字母、数字、下划线、短横线"
        );
        if (password.length() < 6 || password.length() > 64) throw new ApiException(
            400,
            "密码需 6–64 位"
        );
        if (password.getBytes(StandardCharsets.UTF_8).length > 72) throw new ApiException(
            400,
            "新密码的 UTF-8 编码不能超过 72 字节，请减少汉字或符号数量"
        );
        nickname = nickname.substring(0, Math.min(24, nickname.length()));
        String id = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        try {
            accountDao.insert(
                new AccountEntity(
                    id,
                    username,
                    username.toLowerCase(Locale.ROOT),
                    nickname.isEmpty() ? null : nickname,
                    passwords.encode(password),
                    System.currentTimeMillis()
                )
            );
        } catch (DuplicateKeyException e) {
            throw new ApiException(409, "账号已存在");
        }
        reset(sourceIp);
        return new AuthResponse(tokens.issue(id, days), username);
    }

    /** 按创建时间和标识稳定排序，读取全部账号的公开资料。 */
    public List<AccountSummary> all() {
        return accountDao
            .findAll()
            .stream()
            .map(a -> new AccountSummary(a.id(), a.username(), a.nickname()))
            .toList();
    }

    /** 返回可分享账号列表及当前登录账号的公开资料。 */

    public AccountsResponse accounts(String id) {
        List<AccountSummary> list = all();
        List<PublicProfile> visible = list
            .stream()
            .map(a -> new PublicProfile(a.username(), a.nickname()))
            .toList();
        AccountSummary self = list
            .stream()
            .filter(a -> a.id().equals(id))
            .findFirst()
            .orElseThrow();
        return new AccountsResponse(visible, new PublicProfile(self.username(), self.nickname()));
    }

    /** 校验并更新当前账号的昵称。 */

    public ProfileResponse profile(String id, ProfileRequest body) {
        String nick = body.nickname().trim();
        if (nick.length() > 24) throw new ApiException(400, "昵称最多 24 个字");
        accountDao.updateNickname(id, nick.isEmpty() ? null : nick);
        return new ProfileResponse(true, nick.isEmpty() ? null : nick);
    }

    /** 以恒定时间比较服务间密钥，拒绝未经授权的内部调用。 */
    void internal(String key) {
        if (
            key == null ||
            !MessageDigest.isEqual(
                internalKey.getBytes(StandardCharsets.UTF_8),
                key.getBytes(StandardCharsets.UTF_8)
            )
        ) throw new ApiException(403, "Forbidden");
    }

    /** 在服务间鉴权通过后返回当前生效的登录限流值，供发布验证使用。 */

    public LoginPolicyResponse loginPolicy(String key) {
        internal(key);
        return new LoginPolicyResponse(loginPolicy.maxAttempts());
    }

    /** 校验内部调用密钥后返回账号列表，供分享分发使用。 */

    public List<AccountSummary> internalAccounts(String key) {
        internal(key);
        return all();
    }

    /** 校验服务间密钥后判断指定账号是否存在。 */

    public AccountExistsResponse exists(String id, String key) {
        internal(key);
        return new AccountExistsResponse(existsAccount(id));
    }

    /** 为鉴权过滤器提供本地账号存在性查询。 */
    public boolean existsAccount(String id) {
        return accountDao.countById(id) == 1;
    }
}
