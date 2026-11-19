package cn.imlaomi.cloud.user;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cn.imlaomi.cloud.common.config.ApiSecurity;
import cn.imlaomi.cloud.common.exception.ApiErrors;
import cn.imlaomi.cloud.common.util.Tokens;
import cn.imlaomi.cloud.user.config.LoginPolicy;
import cn.imlaomi.cloud.user.controller.UserController;
import cn.imlaomi.cloud.user.dao.*;
import cn.imlaomi.cloud.user.entity.AccountEntity;
import cn.imlaomi.cloud.user.service.UserService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.ObjectMapper;

class UserFlowTest {

    /** 验证拆层后的注册、登录、令牌和公开资料仍兼容原 HTTP 协议。 */
    @Test
    void registersLogsInAndKeepsCredentialsPrivate() throws Exception {
        var dao = mock(AccountDao.class);
        var attempts = mock(LoginAttemptDao.class);
        when(attempts.increment(anyString())).thenReturn(1L);
        var tokens = new Tokens("test-only-secret-at-least-32-characters");
        var service = new UserService(
            dao,
            tokens,
            attempts,
            "invite",
            "internal",
            30,
            new LoginPolicy(5)
        );
        var mvc = MockMvcBuilders.standaloneSetup(new UserController(service))
            .setControllerAdvice(new ApiErrors())
            .build();
        var registration = mvc
            .perform(
                post("/api/register")
                    .header("X-Real-IP", "127.0.0.2")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        "{\"username\":\" Alice \",\"password\":\"secret123\",\"code\":\"invite\",\"nickname\":\" 小米 \"}"
                    )
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.username").value("Alice"))
            .andReturn();
        var captor = ArgumentCaptor.forClass(AccountEntity.class);
        verify(dao).insert(captor.capture());
        var saved = captor.getValue();
        assertThat(saved.usernameKey()).isEqualTo("alice");
        assertThat(saved.nickname()).isEqualTo("小米");
        assertThat(new BCryptPasswordEncoder().matches("secret123", saved.passwordHash())).isTrue();
        assertThat(
            tokens.verify(
                tools.jackson.databind.json.JsonMapper.builder()
                    .build()
                    .readTree(registration.getResponse().getContentAsString())
                    .path("token")
                    .asText()
            )
        ).isEqualTo(saved.id());
        when(dao.findByUsernameKey("alice")).thenReturn(saved);
        mvc.perform(
            post("/api/login")
                .header("X-Real-IP", "127.0.0.2")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"ALICE\",\"password\":\"secret123\"}")
        )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.username").value("Alice"));
        verify(attempts, times(2)).reset("127.0.0.2");
        when(dao.findAll()).thenReturn(List.of(saved));
        mvc.perform(get("/api/accounts").requestAttr(ApiSecurity.ACCOUNT, saved.id()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.self.nickname").value("小米"))
            .andExpect(jsonPath("$.self.passwordHash").doesNotExist())
            .andExpect(jsonPath("$.self.id").doesNotExist());
        mvc.perform(
            post("/api/profile")
                .requestAttr(ApiSecurity.ACCOUNT, saved.id())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"nickname\":\"\"}")
        )
            .andExpect(status().isOk())
            .andExpect(content().json("{\"ok\":true,\"nickname\":null}"));
        verify(dao).updateNickname(saved.id(), null);
    }

    /** 登录限流与内部密钥错误必须在读取账号表之前拒绝。 */
    @Test
    void rejectsThrottledAndUnauthorizedRequests() throws Exception {
        var dao = mock(AccountDao.class);
        var attempts = mock(LoginAttemptDao.class);
        when(attempts.increment(anyString())).thenReturn(6L);
        var service = new UserService(
            dao,
            new Tokens("test-only-secret-at-least-32-characters"),
            attempts,
            "invite",
            "internal",
            30,
            new LoginPolicy(5)
        );
        var mvc = MockMvcBuilders.standaloneSetup(new UserController(service))
            .setControllerAdvice(new ApiErrors())
            .build();
        mvc.perform(
            post("/api/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"alice\",\"password\":\"secret123\"}")
        ).andExpect(status().isTooManyRequests());
        mvc.perform(get("/internal/accounts").header("X-Internal-Key", "wrong")).andExpect(
            status().isForbidden()
        );
        verifyNoInteractions(dao);
    }
}
