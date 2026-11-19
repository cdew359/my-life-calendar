package cn.imlaomi.cloud.calendar;

import static org.assertj.core.api.Assertions.*;

import cn.imlaomi.cloud.calendar.controller.CalendarController;
import cn.imlaomi.cloud.calendar.dto.CalendarData.Plan;
import cn.imlaomi.cloud.calendar.service.CalendarMerge;
import cn.imlaomi.cloud.calendar.service.CalendarService;
import cn.imlaomi.cloud.calendar.util.CalendarJson;
import cn.imlaomi.cloud.calendar.util.DataRules;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.*;
import tools.jackson.databind.node.*;

class DataRulesTest {

    final ObjectMapper json = tools.jackson.databind.json.JsonMapper.builder().build();

    /** 校验 Java 数据规则与 TypeScript 生成的同步兼容用例保持一致。 */
    @Test
    void matchesSharedTypescriptFixtures() throws Exception {
        JsonNode fixtures = json.readTree(getClass().getResourceAsStream("/sync-parity.json"));
        for (JsonNode f : fixtures) {
            ObjectNode actual = json.valueToTree(
                CalendarMerge.merge(
                    CalendarJson.upload(f.path("incoming")),
                    CalendarJson.read(f.path("current"))
                )
            );
            assertThat(
                actual.equals(
                    (a, b) ->
                        a.isNumber() && b.isNumber()
                            ? Double.compare(a.asDouble(), b.asDouble())
                            : a.equals(b)
                              ? 0
                              : 1,
                    f.path("expected")
                )
            )
                .as(f.path("name").asText())
                .isTrue();
        }
    }

    /** 验证取消分享会生成墓碑，接收方删除的分享副本不会重新出现。 */
    @Test
    void shareCancelAndRecipientDeletion() throws Exception {
        var original = new Plan(
            "a",
            "2026-11-18",
            "shared",
            true,
            4,
            1,
            "life",
            5,
            null,
            List.of("bob"),
            null
        );
        var source = List.of(original);
        var received = CalendarService.share("alice", "bob", source, List.of());
        var copy = received.get(0);
        assertThat(copy.id()).isEqualTo("a@alice");
        assertThat(copy.sharedBy()).isEqualTo("alice");
        assertThat(copy.shareWith()).isNull();
        assertThat(copy.done()).isTrue();
        assertThat(copy.doneAt().intValue()).isEqualTo(4);
        assertThat(
            CalendarService.share("alice", "bob", source, List.of(copy.tombstone(6)))
                .get(0)
                .deletedAt()
                .longValue()
        ).isEqualTo(6);
        assertThat(
            CalendarService.share("alice", "bob", List.<Plan>of(), received).get(0).deletedAt()
        ).isNotNull();
        assertThat(original.id()).isEqualTo("a");
        assertThat(original.deletedAt()).isNull();
    }

    /** 验证不存在的日历日期不能通过数据校验。 */
    @Test
    void rejectsImpossibleDates() {
        assertThat(DataRules.validDate("2026-02-30")).isFalse();
        assertThat(DataRules.validDate("2024-02-29")).isTrue();
        assertThat(DataRules.validDate("0000-01-01")).isFalse();
    }
}
