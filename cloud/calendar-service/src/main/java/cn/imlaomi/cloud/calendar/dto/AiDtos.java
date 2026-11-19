package cn.imlaomi.cloud.calendar.dto;

import java.util.List;

/** 模型输入、模型输出与公开草稿使用独立且明确的协议。 */
public final class AiDtos {

    public record EventRequest(
        String clientRequestId,
        String text,
        String selectedDate,
        String timezone,
        String defaultDomain
    ) {}

    public record EventDraft(
        int index,
        String date,
        String title,
        String domain,
        String startTime,
        String endDate,
        String endTime,
        Integer durationMinutes,
        String unresolvedTimeText,
        List<String> questions
    ) {}

    public record EventExtraction(List<EventDraft> drafts) {}

    public record EventResponse(
        String requestId,
        String status,
        String referenceDate,
        String timezone,
        List<EventDraft> drafts,
        List<String> warnings
    ) {}

    public record KnowledgeRequest(
        String clientRequestId,
        String question,
        String keywords,
        String from,
        String to
    ) {}

    public record SupportedClaim(String text, List<String> sourceIds) {}

    public record AnswerExtraction(List<SupportedClaim> claims) {}

    public record AnswerResponse(
        String requestId,
        String answer,
        List<cn.imlaomi.cloud.common.dto.KnowledgeDtos.Evidence> sources,
        String coverage,
        List<String> warnings
    ) {}

    public record Capabilities(boolean enabled, boolean events, boolean knowledge) {}
}
