package cn.imlaomi.cloud.calendar;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cn.imlaomi.cloud.calendar.client.*;
import cn.imlaomi.cloud.calendar.config.AiProperties;
import cn.imlaomi.cloud.calendar.dao.*;
import cn.imlaomi.cloud.calendar.dto.AiDtos.*;
import cn.imlaomi.cloud.calendar.entity.AiRequestEntity;
import cn.imlaomi.cloud.calendar.service.*;
import cn.imlaomi.cloud.common.dto.KnowledgeDtos.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class KnowledgeServiceTest {

    final String id = "6aa2e266-9cc8-4cd6-99e8-554b605193be";
    final AiProperties settings = new AiProperties(
        true,
        "test-model",
        "test-key",
        "http://localhost",
        "test-only-bridge-key-at-least-32-characters",
        20,
        50
    );
    final AiRequestDao audit = mock(AiRequestDao.class);
    final AiQuotaDao quota = mock(AiQuotaDao.class);
    final AiModelClient model = mock(AiModelClient.class);
    final DiaryKnowledgeClient diaries = mock(DiaryKnowledgeClient.class);
    final JsonMapper json = JsonMapper.builder().build();

    /** 创建真实编排与幂等业务，模型和检索边界用桩替代。 */
    KnowledgeService service() {
        when(audit.claim(any())).thenReturn(1);
        when(quota.acquire()).thenReturn("lease");
        return new KnowledgeService(
            new AiRequestService(settings, audit, quota, json),
            model,
            diaries,
            settings,
            json
        );
    }

    /** 明确问题和日期范围，避免依赖隐式筛选。 */
    KnowledgeRequest request() {
        return new KnowledgeRequest(
            id,
            "项目的问题是怎么解决的？",
            "项目",
            "2026-11-01",
            "2026-11-30"
        );
    }

    /** 没有证据时不调用模型；全量统计请求在检索前即拒绝。 */
    @Test
    void noEvidenceAndStatisticsNeverCallModel() {
        var service = service();
        when(diaries.retrieve(anyString(), anyString())).thenReturn(
            new EvidenceResponse(List.of(), false)
        );
        assertThat(service.ask("alice", request()).sources()).isEmpty();
        verifyNoInteractions(model);
        assertThatThrownBy(() ->
            service.ask(
                "alice",
                new KnowledgeRequest(
                    id,
                    "统计本月一共多少次运动",
                    "运动",
                    "2026-11-01",
                    "2026-11-30"
                )
            )
        ).hasMessageContaining("统计");
        verify(diaries, times(1)).retrieve(anyString(), anyString());
    }

    /** 无效引用不能显示为真实出处，回答缓存命中后也必须重新验证日记版本。 */
    @Test
    void fabricatedCitationAndStaleCacheAreRejected() {
        var service = service();
        var evidence = new Evidence("D1", "2026-11-19", "项目", "检查配置解决", 2);
        when(diaries.retrieve(anyString(), anyString())).thenReturn(
            new EvidenceResponse(List.of(evidence), false)
        );
        when(
            model.answer(anyString(), anyString(), anyList(), eq(AnswerExtraction.class))
        ).thenReturn(
            new AiModelClient.Result<>(
                new AnswerExtraction(List.of(new SupportedClaim("答案", List.of("D99")))),
                1,
                1
            )
        );
        assertThatThrownBy(() -> service.ask("alice", request())).hasMessageContaining("无效来源");
        var fingerprint = new java.util.concurrent.atomic.AtomicReference<AiRequestEntity>();
        when(audit.claim(any())).thenAnswer(call -> {
            fingerprint.set(call.getArgument(0));
            return 1;
        });
        when(
            model.answer(anyString(), anyString(), anyList(), eq(AnswerExtraction.class))
        ).thenReturn(
            new AiModelClient.Result<>(
                new AnswerExtraction(List.of(new SupportedClaim("检查配置", List.of("D1")))),
                1,
                1
            )
        );
        when(diaries.verify(anyString(), anyString())).thenReturn(new Verification(true));
        var answer = service.ask("alice", request());
        assertThat(answer.answer()).contains("[D1]");
        var row = fingerprint.get();
        when(audit.claim(any())).thenReturn(0);
        when(audit.find("alice", id)).thenReturn(
            new AiRequestEntity(
                "alice",
                id,
                row.fingerprint(),
                "knowledge",
                "test-model",
                "SUCCEEDED",
                row.createdAt()
            )
        );
        when(quota.cached("alice", id)).thenReturn(json.writeValueAsString(answer));
        when(diaries.verify(anyString(), anyString())).thenReturn(new Verification(false));
        assertThatThrownBy(() -> service.ask("alice", request())).hasMessageContaining(
            "修改或删除"
        );
        verify(model, times(2)).answer(
            anyString(),
            anyString(),
            anyList(),
            eq(AnswerExtraction.class)
        );
    }
}
