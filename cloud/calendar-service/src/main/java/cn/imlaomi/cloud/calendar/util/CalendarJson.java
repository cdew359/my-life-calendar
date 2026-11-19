package cn.imlaomi.cloud.calendar.util;

import cn.imlaomi.cloud.calendar.dto.*;
import java.util.*;
import tools.jackson.databind.JsonNode;

/** JSON 兼容边界：集中处理历史格式和字段缺失，业务层只传递 DTO。 */
public final class CalendarJson {

    /** 清洗后解码为日历实体；规范化中的默认值继续由既有规则提供。 */
    public static CalendarData read(JsonNode raw) {
        try {
            return DataRules.JSON.treeToValue(DataRules.coerce(raw), CalendarData.class);
        } catch (tools.jackson.core.JacksonException failure) {
            throw new IllegalArgumentException("Invalid normalized calendar", failure);
        }
    }

    /** 提取原始时间线的表达能力，避免规范化补齐字段后误判旧客户端。 */
    public static CalendarUploadRequest upload(JsonNode raw) {
        Map<String, CalendarUploadRequest.TimelineShape> shapes = new LinkedHashMap<>();
        for (JsonNode line : DataRules.array(raw == null ? null : raw.get("timelines"))) {
            String id = line.path("id").asText();
            shapes.putIfAbsent(
                id,
                new CalendarUploadRequest.TimelineShape(
                    id,
                    line.has("endTime"),
                    line.path("stepsMode").asBoolean(),
                    DataRules.hasSteps(line),
                    line.path("items").isArray() && line.path("items").isEmpty()
                )
            );
        }
        return new CalendarUploadRequest(read(raw), List.copyOf(shapes.values()));
    }

    /** 将已经规范化的业务快照写入持久化 JSON，序列化失败不返回半份数据。 */
    public static String write(CalendarData data) {
        try {
            return DataRules.JSON.writeValueAsString(data);
        } catch (tools.jackson.core.JacksonException failure) {
            throw new IllegalStateException("Cannot encode calendar", failure);
        }
    }
}
