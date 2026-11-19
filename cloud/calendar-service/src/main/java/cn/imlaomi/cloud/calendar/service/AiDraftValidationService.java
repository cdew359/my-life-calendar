package cn.imlaomi.cloud.calendar.service;

import cn.imlaomi.cloud.calendar.dto.AiDtos.*;
import cn.imlaomi.cloud.calendar.util.DataRules;
import cn.imlaomi.cloud.common.exception.ApiException;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;

/** AI 只能建议字段；类型、日期和分钟运算由程序重新校验。 */
@Service
public class AiDraftValidationService {

    /** 在发送模型前限制输入，拒绝任意时区与分类。 */
    public void validate(EventRequest request) {
        if (
            request == null ||
            request.text() == null ||
            request.text().isBlank() ||
            request.text().length() > 1000 ||
            !DataRules.validDate(Objects.toString(request.selectedDate(), "")) ||
            !"Asia/Shanghai".equals(request.timezone()) ||
            !Set.of("work", "life").contains(Objects.toString(request.defaultDomain(), ""))
        ) throw new ApiException(400, "请输入1～1000字、有效日期和分类，时区使用北京时间");
    }

    /** 清洗模型结果并计算明确的起止耗时，任何非法字段都不能进入计划。 */
    public List<EventDraft> validate(
        EventExtraction extraction,
        EventRequest request,
        LocalDate reference
    ) {
        if (
            extraction == null || extraction.drafts() == null || extraction.drafts().size() > 5
        ) throw invalid();
        List<EventDraft> result = new ArrayList<>();
        for (EventDraft draft : extraction.drafts()) {
            if (
                draft == null ||
                draft.title() == null ||
                draft.title().isBlank() ||
                draft.title().length() > 200 ||
                !DataRules.validDate(Objects.toString(draft.date(), "")) ||
                !Set.of("work", "life").contains(Objects.toString(draft.domain(), ""))
            ) throw invalid();
            String date = draft.date();
            if (extraction.drafts().size() == 1) {
                if (request.text().startsWith("明天")) date = reference.plusDays(1).toString();
                else if (request.text().startsWith("后天")) date = reference.plusDays(2).toString();
                else if (request.text().startsWith("今天")) date = reference.toString();
            }
            String start = optionalTime(draft.startTime()),
                end = optionalTime(draft.endTime());
            String endDate = draft.endDate();
            Integer duration = draft.durationMinutes();
            if (endDate != null && !DataRules.validDate(endDate)) throw invalid();
            if (duration != null && (duration < 1 || duration > 10080)) throw invalid();
            if (end != null) {
                if (start == null) throw invalid();
                if (endDate == null) endDate = date;
                long minutes = Duration.between(
                    LocalDate.parse(date).atTime(LocalTime.parse(start)),
                    LocalDate.parse(endDate).atTime(LocalTime.parse(end))
                ).toMinutes();
                if (minutes < 1 || minutes > 10080) throw invalid();
                duration = (int) minutes;
            }
            List<String> questions = draft.questions() == null ? List.of() : draft.questions();
            if (
                questions.size() > 5 ||
                questions.stream().anyMatch(q -> q == null || q.length() > 150) ||
                (draft.unresolvedTimeText() != null && draft.unresolvedTimeText().length() > 60)
            ) throw invalid();
            result.add(
                new EventDraft(
                    result.size(),
                    date,
                    draft.title().trim(),
                    draft.domain(),
                    start,
                    endDate,
                    end,
                    duration,
                    draft.unresolvedTimeText(),
                    List.copyOf(questions)
                )
            );
        }
        return List.copyOf(result);
    }

    /** 不接受自动纠正后的不合法时间，例如 25:00。 */
    private String optionalTime(String time) {
        if (time != null && !time.matches("([01][0-9]|2[0-3]):[0-5][0-9]")) throw invalid();
        return time;
    }

    /** 返回可由用户重新编辑原文的稳定错误，不展示模型原始正文。 */
    private ApiException invalid() {
        return new ApiException(502, "AI 返回的日期或格式无效，请修改原文后重新生成");
    }
}
