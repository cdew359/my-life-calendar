package cn.imlaomi.cloud.common;

import static org.assertj.core.api.Assertions.*;

import cn.imlaomi.cloud.common.exception.ApiException;
import cn.imlaomi.cloud.common.util.AiBridgeTokens;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

class AiBridgeTokensTest {

    final String secret = "test-only-bridge-key-at-least-32-characters";

    /** 仿 Node 直接对 JSON 和载荷签名，验证跨语言协议及过期策略。 */
    String nodeToken(long expires) throws Exception {
        String body = "{}";
        String digest = java.util.HexFormat.of().formatHex(
            java.security.MessageDigest.getInstance("SHA-256").digest(
                body.getBytes(StandardCharsets.UTF_8)
            )
        );
        String payload = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(
                (
                    "{\"account\":\"alice\",\"audience\":\"ai-events\",\"expires\":" +
                    expires +
                    ",\"digest\":\"" +
                    digest +
                    "\"}"
                ).getBytes(StandardCharsets.UTF_8)
            );
        var mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return (
            payload +
            "." +
            Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.US_ASCII)))
        );
    }

    /** 正确签名能跨语言验证，请求体、用途和签名均不可替换。 */
    @Test
    void bindsIdentityAudienceAndBody() throws Exception {
        var tokens = new AiBridgeTokens(secret);
        var token = nodeToken(System.currentTimeMillis() + 30000);
        assertThat(tokens.verify(token, "ai-events", "{}")).isEqualTo("alice");
        assertThatThrownBy(() -> tokens.verify(token, "ai-knowledge", "{}")).isInstanceOf(
            ApiException.class
        );
        assertThatThrownBy(() ->
            tokens.verify(token, "ai-events", "{\"account\":\"bob\"}")
        ).isInstanceOf(ApiException.class);
        assertThatThrownBy(() ->
            new AiBridgeTokens(secret + "x").verify(token, "ai-events", "{}")
        ).isInstanceOf(ApiException.class);
        assertThat(
            tokens.verify(tokens.issue("bob", "ai-events", "正文"), "ai-events", "正文")
        ).isEqualTo("bob");
    }

    /** 过期、过长有效期以及缺失密钥必须拒绝，不能退回无鉴权模式。 */
    @Test
    void rejectsExpiredFutureAndMissingSecret() throws Exception {
        var tokens = new AiBridgeTokens(secret);
        String expired = nodeToken(System.currentTimeMillis() - 1),
            future = nodeToken(System.currentTimeMillis() + 120000);
        assertThatThrownBy(() -> tokens.verify(expired, "ai-events", "{}")).isInstanceOf(
            ApiException.class
        );
        assertThatThrownBy(() -> tokens.verify(future, "ai-events", "{}")).isInstanceOf(
            ApiException.class
        );
        assertThatThrownBy(() ->
            new AiBridgeTokens("").issue("alice", "ai-events", "{}")
        ).isInstanceOf(ApiException.class);
    }
}
