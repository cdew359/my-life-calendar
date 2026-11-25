package cn.imlaomi.cloud.calendar;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cn.imlaomi.cloud.calendar.client.AiModelClient;
import cn.imlaomi.cloud.calendar.config.AiProperties;
import cn.imlaomi.cloud.calendar.dao.*;
import cn.imlaomi.cloud.calendar.dto.AiDtos.*;
import cn.imlaomi.cloud.calendar.entity.AiRequestEntity;
import cn.imlaomi.cloud.calendar.service.*;
import cn.imlaomi.cloud.common.exception.ApiException;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class AiBehaviorTest {

    final String id = "6aa2e266-9cc8-4cd6-99e8-554b605193be";

    /** 使用非生产密钥启用业务测试，不创建模型客户端。 */
    AiProperties settings(boolean enabled) {
        return new AiProperties(
            enabled,
            "test-model",
            "test-key",
            "http://localhost",
            "test-only-bridge-key-at-least-32-characters",
            20,
            50
        );
    }

    /** 创建跨午夜草稿，不依赖模型准确性来验证确定性业务规则。 */
    EventDraft draft() {
        return new EventDraft(
            99,
            "2026-11-19",
            "  夜间值班  ",
            "work",
            "23:30",
            "2026-11-20",
            "00:30",
            10,
            null,
            List.of()
        );
    }

    /** 输入和输出均严格校验，程序计算明确起止时间而非信任模型的分钟值。 */
    @Test
    void validatesRelativeDateAndCrossMidnight() {
        var service = new AiDraftValidationService();
        var request = new EventRequest(id, "今天夜间值班", "2027-01-01", "Asia/Shanghai", "life");
        service.validate(request);
        var result = service
            .validate(new EventExtraction(List.of(draft())), request, LocalDate.of(2026, 11, 19))
            .get(0);
        assertThat(result.durationMinutes()).isEqualTo(60);
        assertThat(result.date()).isEqualTo("2026-11-19");
        assertThat(result.index()).isZero();
        assertThatThrownBy(() ->
            service.validate(new EventRequest(id, "记录", "2026-02-30", "Asia/Shanghai", "life"))
        ).isInstanceOf(ApiException.class);
        var bad = new EventDraft(
            0,
            "2026-11-19",
            "开会",
            "other",
            null,
            null,
            null,
            0,
            null,
            List.of()
        );
        assertThatThrownBy(() ->
            service.validate(new EventExtraction(List.of(bad)), request, LocalDate.now())
        ).isInstanceOf(ApiException.class);
        var nullQuestion = new EventDraft(
            0,
            "2026-11-19",
            "开会",
            "work",
            null,
            null,
            null,
            1,
            null,
            Arrays.asList((String) null)
        );
        assertThatThrownBy(() ->
            service.validate(new EventExtraction(List.of(nullQuestion)), request, LocalDate.now())
        ).isInstanceOf(ApiException.class);
    }

    /** 真实模型用空字符串表达缺失时间时可正常预览，非空非法时间仍须拒绝。 */
    @Test
    void normalizesOnlyBlankOptionalTimeFields() {
        var service = new AiDraftValidationService();
        var request = new EventRequest(id, "学习Spring AI", "2026-11-21", "Asia/Shanghai", "work");
        var draft = new EventDraft(
            0,
            "2026-11-21",
            "学习Spring AI",
            "work",
            "15:00",
            "",
            " ",
            30,
            "",
            List.of()
        );
        var result = service
            .validate(new EventExtraction(List.of(draft)), request, LocalDate.of(2026, 11, 20))
            .get(0);
        assertThat(result.startTime()).isEqualTo("15:00");
        assertThat(result.endDate()).isNull();
        assertThat(result.endTime()).isNull();
        assertThat(result.unresolvedTimeText()).isNull();
        assertThat(result.durationMinutes()).isEqualTo(30);
        var invalid = new EventDraft(
            0,
            "2026-11-21",
            "学习Spring AI",
            "work",
            "25:00",
            "",
            "",
            30,
            "",
            List.of()
        );
        assertThatThrownBy(() ->
            service.validate(
                new EventExtraction(List.of(invalid)),
                request,
                LocalDate.of(2026, 11, 20)
            )
        ).isInstanceOf(ApiException.class);
    }

    /** 相同请求从缓存返回，内容不一致、缓存失效及账号不同均不能错误重放。 */
    @Test
    void persistentIdempotencyPreventsSecondCall() {
        var audit = mock(AiRequestDao.class);
        var quota = mock(AiQuotaDao.class);
        var service = new AiRequestService(
            settings(true),
            audit,
            quota,
            JsonMapper.builder().build()
        );
        var saved = new AtomicReference<AiRequestEntity>();
        when(audit.claim(any())).thenAnswer(call -> {
            saved.set(call.getArgument(0));
            return 1;
        });
        when(quota.acquire()).thenReturn("lease");
        assertThat(
            service.execute("alice", id, "events", "input", String.class, () ->
                new AiModelClient.Result<>("answer", 1, 2)
            )
        ).isEqualTo("answer");
        var first = saved.get();
        when(audit.claim(any())).thenReturn(0);
        when(audit.find("alice", id)).thenReturn(
            new AiRequestEntity(
                "alice",
                id,
                first.fingerprint(),
                "events",
                "test-model",
                "SUCCEEDED",
                first.createdAt()
            )
        );
        when(quota.cached("alice", id)).thenReturn("\"answer\"");
        assertThat(
            service.execute("alice", id, "events", "input", String.class, () -> {
                throw new AssertionError("must not charge twice");
            })
        ).isEqualTo("answer");
        assertThatThrownBy(() ->
            service.execute("alice", id, "events", "different", String.class, () -> null)
        )
            .isInstanceOf(ApiException.class)
            .hasMessageContaining("其他内容");
        when(quota.cached("alice", id)).thenReturn(null);
        assertThatThrownBy(() ->
            service.execute("alice", id, "events", "input", String.class, () -> null)
        ).hasMessageContaining("过期");
        assertThatThrownBy(() ->
            service.execute("bob", id, "events", "input", String.class, () -> null)
        ).hasMessageContaining("其他内容");
        verify(quota, times(1)).acquire();
        verify(quota).release("lease");
    }

    /** 功能关闭不接触配额；上游失败只结束请求并释放租约，不自动再次生成。 */
    @Test
    void offAndFailureDoNotRetry() {
        var audit = mock(AiRequestDao.class);
        var quota = mock(AiQuotaDao.class);
        var off = new AiRequestService(settings(false), audit, quota, JsonMapper.builder().build());
        assertThatThrownBy(() ->
            off.execute("alice", id, "events", "input", String.class, () -> null)
        ).hasMessageContaining("尚未启用");
        verifyNoInteractions(audit, quota);
        var on = new AiRequestService(settings(true), audit, quota, JsonMapper.builder().build());
        when(audit.claim(any())).thenReturn(1);
        when(quota.acquire()).thenReturn("lease");
        assertThatThrownBy(() ->
            on.execute("alice", id, "events", "input", String.class, () -> {
                throw new IllegalStateException("private provider detail");
            })
        ).hasMessageNotContaining("private provider detail");
        verify(audit).finish(
            eq("alice"),
            eq(id),
            eq("FAILED"),
            isNull(),
            isNull(),
            anyLong(),
            anyLong()
        );
        verify(quota).release("lease");
        verify(quota, never()).cache(any(), any(), any());
    }

    /** 配额拒绝时不调用模型，并释放已获取的并发名额。 */
    @Test
    void quotaRejectionNeverCallsModel() {
        var audit = mock(AiRequestDao.class);
        var quota = mock(AiQuotaDao.class);
        when(audit.claim(any())).thenReturn(1);
        when(quota.acquire()).thenReturn("lease");
        doThrow(new ApiException(429, "配额已用完")).when(quota).reserve("alice", 20, 50);
        var service = new AiRequestService(
            settings(true),
            audit,
            quota,
            JsonMapper.builder().build()
        );
        assertThatThrownBy(() ->
            service.execute("alice", id, "events", "input", String.class, () -> {
                throw new AssertionError("no model call");
            })
        ).hasMessageContaining("配额");
        verify(quota).release("lease");
    }
}
