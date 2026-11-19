package cn.imlaomi.cloud.user;

import static org.assertj.core.api.Assertions.*;

import cn.imlaomi.cloud.user.dto.UserDtos.*;
import cn.imlaomi.cloud.user.entity.AccountEntity;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class UserDtoTest {

    final ObjectMapper json = tools.jackson.databind.json.JsonMapper.builder().build();

    /** 防止 Jackson 默认把数字等错误输入转换成有效的用户名、密码或昵称。 */
    @Test
    void preservesStrictTextAndMissingFieldDefaults() throws Exception {
        var login = json.readValue(
            "{\"username\":123,\"password\":true,\"legacyField\":1}",
            LoginRequest.class
        );
        assertThat(login.username()).isEmpty();
        assertThat(login.password()).isEmpty();
        var registration = json.readValue(
            "{\"username\":\"alice\",\"password\":\"secret\",\"code\":\"invite\",\"nickname\":null}",
            RegisterRequest.class
        );
        assertThat(registration.password()).isEqualTo("secret");
        assertThat(registration.code()).isEqualTo("invite");
        assertThat(registration.nickname()).isEmpty();
        assertThat(json.readValue("{}", ProfileRequest.class).nickname()).isEmpty();
    }

    /** 验证公开响应保持旧字段与 null 约定，数据库哈希及请求密码不会被序列化。 */
    @Test
    void keepsPublicContractsAndCredentialsSeparate() throws Exception {
        var profile = new PublicProfile("alice", null);
        var accounts = json.valueToTree(new AccountsResponse(List.of(profile), profile));
        assertThat(accounts.at("/self/nickname").isNull()).isTrue();
        assertThat(accounts.at("/users/0").size()).isEqualTo(2);
        assertThat(
            json
                .valueToTree(new AccountEntity("id", "alice", "alice", null, "sensitive-hash", 1))
                .has("passwordHash")
        ).isFalse();
        assertThat(json.valueToTree(new LoginRequest("alice", "secret")).has("password")).isFalse();
        var register = new RegisterRequest("alice", "secret", "invite", "nickname");
        assertThat(json.valueToTree(register).has("code")).isFalse();
        assertThat(register.toString()).doesNotContain("secret", "invite");
        var auth = new AuthResponse("sensitive-token", "alice");
        assertThat(json.valueToTree(auth).path("token").asText()).isEqualTo("sensitive-token");
        assertThat(auth.toString()).doesNotContain("sensitive-token");
    }
}
