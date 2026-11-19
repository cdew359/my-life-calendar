package cn.imlaomi.cloud.user.dto;

import cn.imlaomi.cloud.common.util.TextInputDeserializer;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import tools.jackson.databind.annotation.JsonDeserialize;

/** 用户接口的输入和输出协议；公开响应与数据库凭据记录分离。 */
public final class UserDtos {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record LoginRequest(
        @JsonDeserialize(using = TextInputDeserializer.class) String username,
        @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
        @JsonDeserialize(using = TextInputDeserializer.class)
        String password
    ) {
        /** 对缺失或显式为空的字符串沿用旧接口的空字符串语义。 */
        public LoginRequest {
            username = value(username);
            password = value(password);
        }

        /** 避免对象被日志输出时泄露密码。 */
        @Override
        public String toString() {
            return "LoginRequest[credentials redacted]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RegisterRequest(
        @JsonDeserialize(using = TextInputDeserializer.class) String username,
        @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
        @JsonDeserialize(using = TextInputDeserializer.class)
        String password,
        @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
        @JsonDeserialize(using = TextInputDeserializer.class)
        String code,
        @JsonDeserialize(using = TextInputDeserializer.class) String nickname
    ) {
        /** 保留历史请求中缺失字段的默认值。 */
        public RegisterRequest {
            username = value(username);
            password = value(password);
            code = value(code);
            nickname = value(nickname);
        }

        /** 注册码和密码均不能进入对象日志。 */
        @Override
        public String toString() {
            return "RegisterRequest[credentials redacted]";
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ProfileRequest(
        @JsonDeserialize(using = TextInputDeserializer.class) String nickname
    ) {
        /** 空昵称表示清除昵称，与旧接口保持一致。 */
        public ProfileRequest {
            nickname = value(nickname);
        }
    }

    public record AuthResponse(String token, String username) {
        /** 防止登录令牌被对象日志泄露。 */
        @Override
        public String toString() {
            return "AuthResponse[token redacted]";
        }
    }

    public record PublicProfile(String username, String nickname) {}

    public record AccountsResponse(List<PublicProfile> users, PublicProfile self) {}

    public record ProfileResponse(boolean ok, String nickname) {}

    public record LoginPolicyResponse(int maxAttempts) {}

    /** 统一请求字段的空值，避免控制器重复判断。 */
    private static String value(String input) {
        return input == null ? "" : input;
    }
}
