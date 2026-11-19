package cn.imlaomi.cloud.diary;

import static org.assertj.core.api.Assertions.*;

import cn.imlaomi.cloud.common.exception.ApiException;
import cn.imlaomi.cloud.diary.dao.DiarySearchDao;
import cn.imlaomi.cloud.diary.dto.DiaryDtos.*;
import cn.imlaomi.cloud.diary.util.DiaryDates;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class DiaryContractTest {

    /** 验证搜索始终限制当前账号、过滤删除记录并正确应用分页和关键词。 */
    @Test
    void queryAlwaysScopesOwnerAndDeletion() throws Exception {
        var body = tools.jackson.databind.json.JsonMapper.builder()
            .build()
            .valueToTree(DiarySearchDao.query("owner-only", "上海", "2026-01-01", "2026-12-31", 2));
        assertThat(body.at("/query/bool/filter/0/term/accountId").asText()).isEqualTo("owner-only");
        assertThat(body.at("/query/bool/filter/1/term/deleted").asBoolean()).isFalse();
        assertThat(body.path("from").asInt()).isEqualTo(20);
        assertThat(body.at("/query/bool/must/0/multi_match/query").asText()).isEqualTo("上海");
    }

    /** 验证日记日期和整数版本号的边界校验。 */
    @Test
    void validatesDatesAndRevisions() throws Exception {
        assertThat(DiaryDates.validDate("2026-02-30")).isFalse();
        assertThat(DiaryDates.validDate("2024-02-29")).isTrue();
        var json = tools.jackson.databind.json.JsonMapper.builder().build();
        for (String invalid : new String[] {
            "1.1",
            "-1",
            "\"1\"",
            "null",
            "2147483647",
            "2147483648",
            "true",
        }) {
            assertThatThrownBy(() ->
                json.readValue(
                    "{\"title\":\"\",\"content\":\"text\",\"expectedRevision\":" + invalid + "}",
                    SaveDiaryRequest.class
                )
            )
                .isInstanceOf(ApiException.class)
                .hasMessage("版本号无效");
        }
        assertThatThrownBy(() ->
            json.readValue("{\"expectedRevision\":0}", DeleteDiaryRequest.class)
        ).isInstanceOf(ApiException.class);
        assertThat(
            json.readValue(
                "{\"title\":\" title \",\"content\":\" text \",\"expectedRevision\":0}",
                SaveDiaryRequest.class
            )
        ).isEqualTo(new SaveDiaryRequest("title", " text ", 0));
    }
}
