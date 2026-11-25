package cn.imlaomi.cloud.common;

import static org.assertj.core.api.Assertions.*;

import cn.imlaomi.cloud.common.util.Tokens;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

class TokensTest {

    final String secret = "integration-only-secret-at-least-32-bytes";

    /** 验证令牌能够签发和校验，同时拒绝被篡改的签名。 */
    @Test
    void roundTripAndTamper() {
        Tokens tokens = new Tokens(secret);
        String token = tokens.issue("account-a", 30);
        assertThat(tokens.verify(token)).isEqualTo("account-a");
        assertThat(new Tokens(secret + "different").verify(token)).isNull();
        assertThat(tokens.verify(token + "x")).isNull();
        assertThat(tokens.verify(tokens.issue("account-a", -1))).isNull();
        assertThat(tokens.verify("invalid")).isNull();
    }

    /** 验证 Java 令牌与 Node 协议兼容，并按毫秒识别到期时间。 */
    @Test
    void nodeWireFormatWithMilliseconds() throws Exception {
        String payload = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(
                "{\"acc\":\"node-account\",\"exp\":4102444800000}".getBytes(StandardCharsets.UTF_8)
            );
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String token =
            payload +
            "." +
            Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        assertThat(new Tokens(secret).verify(token)).isEqualTo("node-account");
    }

    /** 验证迁移同时保留两套会话，并拒绝过期、篡改和其他密钥签发的令牌。 */
    @Test
    void migrationPreservesBothSessionsWithoutTrustingOtherKeys() {
        String oldSecret = secret + "-previous";
        Tokens migration = new Tokens(secret, oldSecret);
        assertThat(migration.verify(new Tokens(secret).issue("node-account", 30))).isEqualTo(
            "node-account"
        );
        assertThat(migration.verify(new Tokens(oldSecret).issue("cloud-account", 30))).isEqualTo(
            "cloud-account"
        );
        assertThat(migration.verify(new Tokens(oldSecret).issue("cloud-account", -1))).isNull();
        assertThat(migration.verify(new Tokens(secret + "-untrusted").issue("other", 30))).isNull();
        assertThat(
            migration.verify(new Tokens(oldSecret).issue("cloud-account", 30) + "x")
        ).isNull();
        assertThat(new Tokens(secret).verify(migration.issue("new-account", 30))).isEqualTo(
            "new-account"
        );
    }
}
