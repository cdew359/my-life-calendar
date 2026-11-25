package cn.imlaomi.cloud.common.util;

import cn.imlaomi.cloud.common.exception.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import tools.jackson.databind.json.JsonMapper;

/** 私网 AI 桥接身份：签名同时绑定账号、接口用途、请求体和短有效期。 */
public final class AiBridgeTokens {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final String secret;

    public record Claims(String account, String audience, long expires, String digest) {}

    /** 保存专用于 AI 桥接的密钥，不复用登录令牌密钥。 */
    public AiBridgeTokens(String secret) {
        this.secret = secret;
    }

    /** 为可信服务签发三十秒有效、绑定完整请求体的凭据。 */
    public String issue(String account, String audience, String body) {
        try {
            String payload = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(
                    JSON.writeValueAsBytes(
                        new Claims(
                            account,
                            audience,
                            System.currentTimeMillis() + 30000,
                            digest(body)
                        )
                    )
                );
            return (
                payload +
                "." +
                Base64.getUrlEncoder().withoutPadding().encodeToString(sign(payload))
            );
        } catch (ApiException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new ApiException(503, "AI 内部鉴权暂不可用");
        }
    }

    /** 拒绝过期、用途错误、伪造签名和被篡改的请求体，只返回已验证的账号。 */
    public String verify(String token, String audience, String body) {
        //确认秘钥存在
        if (secret == null || secret.length() < 32) throw new ApiException(503, "AI 桥接尚未配置");
        try {
            //确认token存在
            if (token == null || token.length() > 2048) throw new IllegalArgumentException();
            //token：编码后的载荷.编码后的签名
            String[] parts = token.split("\\.", -1);
            //校验token格式是否正确，然后校验载荷和签名做了Base64转换之后是否一致
            if (
                parts.length != 2 ||
                !MessageDigest.isEqual(sign(parts[0]), Base64.getUrlDecoder().decode(parts[1]))
            ) throw new IllegalArgumentException();
            //将载荷转成对象
            Claims claims = JSON.readValue(Base64.getUrlDecoder().decode(parts[0]), Claims.class);
            //检查是否超时、账号是否存在、账号格式是否合法、摘要是否一致
            long remaining = claims.expires() - System.currentTimeMillis();
            if (
                !audience.equals(claims.audience()) ||
                remaining <= 0 ||
                remaining > 60000 ||
                claims.account() == null ||
                !claims.account().matches("[A-Za-z0-9_-]{1,48}") ||
                !MessageDigest.isEqual(
                    digest(body).getBytes(StandardCharsets.US_ASCII),
                    claims.digest().getBytes(StandardCharsets.US_ASCII)
                )
            ) throw new IllegalArgumentException();
            return claims.account();
        } catch (Exception failure) {
            throw new ApiException(403, "AI 内部鉴权失败");
        }
    }

    /** 用 SHA-256 绑定请求内容，摘要不代表账号授权。 */
    private static String digest(String body) throws Exception {
        return java.util.HexFormat.of().formatHex(
            MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8))
        );
    }

    /** 对完整 Base64 载荷签名，禁止未配置密钥时签发。 */
    private byte[] sign(String payload) throws Exception {
        if (secret == null || secret.length() < 32) throw new ApiException(503, "AI 桥接尚未配置");
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return mac.doFinal(payload.getBytes(StandardCharsets.US_ASCII));
    }
}
