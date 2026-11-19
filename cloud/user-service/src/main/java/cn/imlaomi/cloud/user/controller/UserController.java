package cn.imlaomi.cloud.user.controller;

import cn.imlaomi.cloud.common.config.ApiSecurity;
import cn.imlaomi.cloud.common.dto.*;
import cn.imlaomi.cloud.user.dto.UserDtos.*;
import cn.imlaomi.cloud.user.service.UserService;
import cn.imlaomi.cloud.user.util.RequestSources;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.web.bind.annotation.*;

/** 账号 HTTP 入口，只提取请求上下文并委托业务层。 */
@RestController
public class UserController {

    private final UserService service;

    /** 注入账号业务。 */
    public UserController(UserService service) {
        this.service = service;
    }

    /** 登录并签发令牌。 */
    @PostMapping("/api/login")
    public AuthResponse login(@RequestBody LoginRequest body, HttpServletRequest request) {
        return service.login(body, RequestSources.ip(request));
    }

    /** 使用注册码创建账号。 */
    @PostMapping("/api/register")
    public AuthResponse register(@RequestBody RegisterRequest body, HttpServletRequest request) {
        return service.register(body, RequestSources.ip(request));
    }

    /** 读取当前用户及可分享账号。 */
    @GetMapping("/api/accounts")
    public AccountsResponse accounts(@RequestAttribute(ApiSecurity.ACCOUNT) String id) {
        return service.accounts(id);
    }

    /** 修改当前用户昵称。 */
    @PostMapping("/api/profile")
    public ProfileResponse profile(
        @RequestAttribute(ApiSecurity.ACCOUNT) String id,
        @RequestBody ProfileRequest body
    ) {
        return service.profile(id, body);
    }

    /** 返回经内部密钥保护的登录策略。 */
    @GetMapping("/internal/config/login-policy")
    public LoginPolicyResponse loginPolicy(
        @RequestHeader(value = "X-Internal-Key", required = false) String key
    ) {
        return service.loginPolicy(key);
    }

    /** 为内部服务提供分享账号。 */
    @GetMapping("/internal/accounts")
    public List<AccountSummary> internalAccounts(
        @RequestHeader(value = "X-Internal-Key", required = false) String key
    ) {
        return service.internalAccounts(key);
    }

    /** 为内部服务校验账号是否存在。 */
    @GetMapping("/internal/accounts/{id}")
    public AccountExistsResponse exists(
        @PathVariable String id,
        @RequestHeader(value = "X-Internal-Key", required = false) String key
    ) {
        return service.exists(id, key);
    }
}
