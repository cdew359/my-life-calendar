package cn.imlaomi.cloud.calendar.service;

import cn.imlaomi.cloud.calendar.dto.AiDtos.*;
import cn.imlaomi.cloud.calendar.util.DataRules;
import cn.imlaomi.cloud.common.exception.ApiException;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;

/**
 * AI 计划草稿的确定性业务校验，分为调用前输入检查和调用后输出检查。
 *
 * <p>JSON 能转换成 DTO 不代表业务合法；本类限定最多五条、允许的分类和时间格式，
 * 并用 Java 日期 API 计算明确起止时间。它不调用模型，也不保存计划。
 */
@Service
public class AiDraftValidationService {

    /**
     * 调用前检查用户输入，避免无效参数消耗模型请求。
     *
     * @param request 1～1000 字原文、有效选中日期、Asia/Shanghai 和 work/life 默认分类
     * @throws ApiException 原文为空、超长或日期、时区、分类不符合约束时返回 400
     */
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

    /**
     * 校验整批模型草稿并生成规范结果；一条不合法则拒绝整批，避免部分草稿悄悄丢失。
     *
     * <p>单条事项且原文以“今天/明天/后天”开头时，用服务端参考日纠正日期；
     * 其他日期解析仍依赖模型建议和用户预览，不是完整的自然语言日期解析器。
     * 明确的起止时间重新计算耗时，跨天必须用结束日期表达，不自行猜测“次日”。
     *
     * @param extraction 模型结构化结果，drafts 可为空列表但不能为 null，最多五条
     * @param request 已通过调用前校验的用户请求
     * @param reference 本次生成时固定的北京时间参考日期
     * @return 重新分配顺序编号、修剪标题并复制列表的草稿集合
     * @throws ApiException 输出日期、分类、时间、耗时或问题描述不符合约束时返回 502
     */
    public List<EventDraft> validate(
        EventExtraction extraction,
        EventRequest request,
        LocalDate reference
    ) {
        if (
            //草稿最多5条
            extraction == null ||
            extraction.drafts() == null ||
            extraction.drafts().size() > 5
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
            // 只覆盖明确、简单的单事项前缀，避免把多事项中的相对日期一律改成同一天。
            if (extraction.drafts().size() == 1) {
                if (request.text().startsWith("明天")) date = reference.plusDays(1).toString();
                else if (request.text().startsWith("后天")) date = reference.plusDays(2).toString();
                else if (request.text().startsWith("今天")) date = reference.toString();
            }
            String start = optionalTime(draft.startTime()),
                end = optionalTime(draft.endTime());
            String endDate = optionalText(draft.endDate());
            Integer duration = draft.durationMinutes();
            //校验结束日期
            if (endDate != null && !DataRules.validDate(endDate)) throw invalid();
            //校验预计耗时
            if (duration != null && (duration < 1 || duration > 10080)) throw invalid();
            // 同时有结束时刻时，起止运算结果优先于模型给出的分钟数，限制为1分钟至7天。
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
                    optionalText(draft.unresolvedTimeText()),
                    List.copyOf(questions)
                )
            );
        }
        return List.copyOf(result);
    }

    /** 不接受自动纠正后的不合法时间，例如 25:00。 */
    private String optionalTime(String time) {
        time = optionalText(time);
        if (time != null && !time.matches("([01][0-9]|2[0-3]):[0-5][0-9]")) throw invalid();
        return time;
    }

    /** 将模型对“未提供”的空字符串统一为 null，不猜测或修正非空日期和时间。 */
    private String optionalText(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /** 返回可由用户重新编辑原文的稳定错误，不展示模型原始正文。 */
    private ApiException invalid() {
        return new ApiException(502, "AI 返回的日期或格式无效，请修改原文后重新生成");
    }
}
