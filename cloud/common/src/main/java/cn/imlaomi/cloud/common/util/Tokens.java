package cn.imlaomi.cloud.common.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import tools.jackson.databind.ObjectMapper;

/** Wire compatible with the existing Node HMAC token, including millisecond expiry. */
public class Tokens {

    private static final ObjectMapper JSON =
        tools.jackson.databind.json.JsonMapper.builder().build();
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private final byte[] secret;

    /** 校验并保存令牌签名密钥，拒绝过短的密钥配置。 */
    public Tokens(String secret) {
        if (secret == null || secret.length() < 32) throw new IllegalArgumentException(
            "TOKEN_SECRET must contain at least 32 characters"
        );
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    /** 对令牌载荷计算 HMAC-SHA256 签名。 */
    private byte[] sign(String payload) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret, "HmacSHA256"));
        return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
    }

    /** 生成包含账号标识和毫秒级到期时间的签名令牌。 */
    public String issue(String account, int days) {
        try {
            String payload = ENCODER.encodeToString(
                JSON.writeValueAsBytes(
                    Map.of("acc", account, "exp", System.currentTimeMillis() + days * 86400000L)
                )
            );
            return payload + "." + ENCODER.encodeToString(sign(payload));
        } catch (Exception e) {
            throw new IllegalStateException("Token generation failed");
        }
    }

    /**
     * 验证与旧 Node 后端兼容的签名令牌，使用恒定时间比较签名，并按毫秒检查到期时间。
     *
     * @param token 客户端提交的载荷与签名，不包含 Bearer 前缀
     * @return 合法令牌对应的账号标识；格式错误、签名不符或已过期时返回 null
     */
    public String verify(String token) {
        try {
            String[] parts = token.split("\\.", -1);
            if (
                parts.length != 2 ||
                token.length() > 2048 ||
                !MessageDigest.isEqual(sign(parts[0]), Base64.getUrlDecoder().decode(parts[1]))
            ) return null;
            var body = JSON.readTree(Base64.getUrlDecoder().decode(parts[0]));
            return body.path("acc").isTextual() &&
                body.path("exp").isNumber() &&
                body.path("exp").asLong() > System.currentTimeMillis()
                ? body.path("acc").asText()
                : null;
        } catch (Exception e) {
            return null;
        }
    }
}
