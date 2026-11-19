package cn.imlaomi.cloud.calendar.dto;

import cn.imlaomi.cloud.calendar.util.CalendarJson;
import cn.imlaomi.cloud.common.exception.ApiException;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.io.IOException;
import java.util.List;
import tools.jackson.core.JsonParser;
import tools.jackson.databind.*;
import tools.jackson.databind.annotation.JsonDeserialize;

/** 日历上传 DTO；协议能力信息仅在 JSON 边界提取，不携带原始 JSON 到业务层。 */
@JsonDeserialize(using = CalendarUploadRequest.Deserializer.class)
public record CalendarUploadRequest(
    CalendarData data,
    @JsonIgnore List<TimelineShape> timelineShapes
) {
    public record TimelineShape(
        String id,
        boolean deadlineProvided,
        boolean stepsMode,
        boolean embeddedSteps,
        boolean emptyItems
    ) {}

    public static final class Deserializer extends ValueDeserializer<CalendarUploadRequest> {

        /** 兼容历史脏数据，在进入控制器之前规范为明确的日历实体对象。 */
        @Override
        public CalendarUploadRequest deserialize(
            JsonParser parser,
            DeserializationContext context
        ) {
            JsonNode root = context.readTree(parser);
            if (!root.path("data").isObject()) throw new ApiException(400, "缺少 data 字段");
            if (
                root.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length >
                2 * 1024 * 1024
            ) throw new ApiException(413, "数据过大");
            return CalendarJson.upload(root.get("data"));
        }
    }
}
