package cn.imlaomi.cloud.calendar;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cn.imlaomi.cloud.calendar.client.UserClient;
import cn.imlaomi.cloud.calendar.controller.CalendarController;
import cn.imlaomi.cloud.calendar.dao.CalendarStateDao;
import cn.imlaomi.cloud.calendar.dto.CalendarUploadRequest;
import cn.imlaomi.cloud.calendar.service.CalendarService;
import cn.imlaomi.cloud.calendar.util.CalendarJson;
import cn.imlaomi.cloud.common.config.ApiSecurity;
import cn.imlaomi.cloud.common.exception.ApiErrors;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.ObjectMapper;

class CalendarDtoTest {

    final ObjectMapper json = tools.jackson.databind.json.JsonMapper.builder().build();

    /** 验证 DTO 持久化不会重复转换旧时间线，并保留协议字段的缺失与空值差异。 */
    @Test
    void roundTripsAllHistoricalSnapshots() throws Exception {
        var fixtures = json.readTree(getClass().getResourceAsStream("/sync-parity.json"));
        for (var fixture : fixtures) {
            var data = CalendarJson.read(fixture.path("expected"));
            var saved = json.readTree(CalendarJson.write(data));
            var reread = CalendarJson.read(saved);
            assertThat(reread).as(fixture.path("name").asText()).isEqualTo(data);
        }
        var request = json.readValue("{\"data\":{}}", CalendarUploadRequest.class);
        var encoded = json.valueToTree(request);
        assertThat(encoded.has("timelineShapes")).isFalse();
        assertThat(encoded.at("/data/homeCity").isNull()).isTrue();
    }

    /** 验证真实 MVC 反序列化路径保留业务错误，不将缺失 data 或超大请求误报为 503。 */
    @Test
    void rejectsInvalidRequestsBeforeTouchingBusinessDependencies() throws Exception {
        var db = mock(CalendarStateDao.class);
        var users = mock(UserClient.class);
        var mvc = MockMvcBuilders.standaloneSetup(
            new CalendarController(new CalendarService(db, users, json))
        )
            .setControllerAdvice(new ApiErrors())
            .build();
        mvc.perform(
            post("/api/data")
                .requestAttr(ApiSecurity.ACCOUNT, "owner")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"data\":[]}")
        )
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("缺少 data 字段"));
        mvc.perform(
            post("/api/data")
                .requestAttr(ApiSecurity.ACCOUNT, "owner")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"data\":{},\"extra\":\"" + "a".repeat(2 * 1024 * 1024) + "\"}")
        )
            .andExpect(status().isPayloadTooLarge())
            .andExpect(jsonPath("$.error").value("数据过大"));
        verifyNoInteractions(db, users);
    }
}
