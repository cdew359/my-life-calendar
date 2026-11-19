package cn.imlaomi.cloud.diary.dto;

import cn.imlaomi.cloud.common.exception.ApiException;
import cn.imlaomi.cloud.diary.entity.DiaryEntryEntity;
import cn.imlaomi.cloud.diary.service.DiaryEntryService;
import java.io.IOException;
import java.util.List;
import tools.jackson.core.JsonParser;
import tools.jackson.databind.*;
import tools.jackson.databind.annotation.JsonDeserialize;

/** 日记接口协议，与数据库记录分离，严格保留原有版本校验及空值约定。 */
public final class DiaryDtos {

    @JsonDeserialize(using = SaveRequestDeserializer.class)
    public record SaveDiaryRequest(String title, String content, int expectedRevision) {}

    @JsonDeserialize(using = DeleteRequestDeserializer.class)
    public record DeleteDiaryRequest(int expectedRevision) {}

    public record DiaryEntryResponse(
        String date,
        String title,
        String content,
        int revision,
        long createdAt,
        long updatedAt,
        boolean deleted
    ) {
        /** 将数据库记录转换为允许对外公开的日记字段。 */
        public static DiaryEntryResponse from(DiaryEntryEntity entry) {
            return new DiaryEntryResponse(
                entry.date(),
                entry.title(),
                entry.content(),
                entry.revision(),
                entry.createdAt(),
                entry.updatedAt(),
                entry.deleted()
            );
        }
    }

    public record GetDiaryResponse(DiaryEntryResponse entry, int revision) {}

    public record SaveDiaryResponse(DiaryEntryResponse entry, boolean searchPending) {}

    public record DeleteDiaryResponse(int revision) {}

    public record SearchDiaryResponse(
        List<DiaryEntryResponse> items,
        long total,
        int page,
        int pageSize,
        boolean indexing
    ) {}

    public record ReindexResponse(int queued) {}

    /** 接口版本必须是真正的整数，拒绝小数、字符串、溢出及无法继续递增的最大值。 */
    private static int revision(JsonNode body, int min) {
        JsonNode value = body.path("expectedRevision");
        if (
            !value.isIntegralNumber() ||
            !value.canConvertToInt() ||
            value.asInt() < min ||
            value.asInt() == Integer.MAX_VALUE
        ) throw new ApiException(400, "版本号无效");
        return value.asInt();
    }

    public static final class SaveRequestDeserializer extends ValueDeserializer<SaveDiaryRequest> {

        /** 在 JSON 边界完成严格校验，业务方法只接收已经明确类型的请求。 */
        @Override
        public SaveDiaryRequest deserialize(JsonParser parser, DeserializationContext context) {
            JsonNode body = context.readTree(parser);
            int expected = revision(body, 0);
            if (
                !body.path("title").isTextual() ||
                !body.path("content").isTextual() ||
                body.path("title").asText().length() > 100 ||
                body.path("content").asText().length() > 20000 ||
                body.path("content").asText().trim().isEmpty()
            ) throw new ApiException(400, "标题最多100字，正文1～20000字");
            return new SaveDiaryRequest(
                body.path("title").asText().trim(),
                body.path("content").asText(),
                expected
            );
        }
    }

    public static final class DeleteRequestDeserializer
        extends ValueDeserializer<DeleteDiaryRequest>
    {

        /** 删除操作要求已存在版本，避免把缺失的日记误当作成功删除。 */
        @Override
        public DeleteDiaryRequest deserialize(JsonParser parser, DeserializationContext context) {
            return new DeleteDiaryRequest(revision(context.readTree(parser), 1));
        }
    }
}
