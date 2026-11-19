package cn.imlaomi.cloud.user;

import static org.assertj.core.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import tools.jackson.databind.ObjectMapper;

class PasswordCompatibilityTest {

    /** 验证现有 Node 密码哈希仍可登录，包括历史上超过 72 字节的 UTF-8 密码。 */
    @Test
    void acceptsExistingNodeHashesIncludingLegacyLongUtf8Passwords() throws Exception {
        var fixtures = tools.jackson.databind.json.JsonMapper.builder()
            .build()
            .readTree(getClass().getResourceAsStream("/bcrypt-compat.json"));
        var passwords = new BCryptPasswordEncoder();
        for (var entry : fixtures) {
            assertThat(
                passwords.matches(entry.path("password").asText(), entry.path("hash").asText())
            ).isTrue();
            assertThat(passwords.matches("incorrect", entry.path("hash").asText())).isFalse();
        }
    }
}
