package cn.imlaomi.cloud.common.util;

import java.io.IOException;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;

/** 兼容旧账号接口：只接收真正的 JSON 字符串，其他类型按空字符串处理。 */
public final class TextInputDeserializer extends ValueDeserializer<String> {

    /** 防止 Jackson 把数字或布尔值隐式转换成账号、密码或昵称。 */
    @Override
    public String deserialize(JsonParser parser, DeserializationContext context) {
        if (parser.hasToken(JsonToken.VALUE_STRING)) return parser.getText();
        parser.skipChildren();
        return "";
    }
}
