package cn.imlaomi.cloud.calendar.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/** 多端同步的完整日历快照；数字时间戳保留原协议精度，缺失可选字段不输出为 null。 */
public record CalendarData(
    int version,
    List<Plan> plans,
    List<DayNote> notes,
    List<Habit> habits,
    List<Anniversary> anniversaries,
    List<Reminder> reminders,
    List<Timeline> timelines,
    HomeCity homeCity,
    HomeCity watchCity
) {
    /** 防止一个业务组件修改传输对象的列表而影响其他调用者。 */
    public CalendarData {
        plans = List.copyOf(plans);
        notes = List.copyOf(notes);
        habits = List.copyOf(habits);
        anniversaries = List.copyOf(anniversaries);
        reminders = List.copyOf(reminders);
        timelines = List.copyOf(timelines);
    }

    /** 仅替换分发后的计划与记录，保留接收账号的其他私有数据。 */
    public CalendarData withSharedEntries(List<Plan> nextPlans, List<DayNote> nextNotes) {
        return new CalendarData(
            version,
            nextPlans,
            nextNotes,
            habits,
            anniversaries,
            reminders,
            timelines,
            homeCity,
            watchCity
        );
    }

    public interface SyncItem {
        /** 返回跨设备稳定的条目标识。 */
        String id();
        /** 返回最后更新时间，用于最后写入获胜。 */
        Number updatedAt();
        /** 返回删除时间；空值表示仍存在。 */
        Number deletedAt();
    }

    public interface SharedItem<T> extends SyncItem {
        /** 返回分享接收账号；空值表示没有分享。 */
        List<String> shareWith();
        /** 返回收到的分享来源；空值表示本人条目。 */
        String sharedBy();
        /** 创建接收方副本，移除二次分享对象。 */
        T shared(String targetId, String owner);
        /** 创建取消分享的删除墓碑。 */
        T tombstone(long now);
    }

    public record Plan(
        String id,
        String date,
        String text,
        boolean done,
        Number doneAt,
        long createdAt,
        String domain,
        Number updatedAt,
        Number deletedAt,
        @JsonInclude(JsonInclude.Include.NON_NULL) List<String> shareWith,
        @JsonInclude(JsonInclude.Include.NON_NULL) String sharedBy
    ) implements SharedItem<Plan> {
        /** 构造分享副本，保留完成状态及其时间戳。 */
        public Plan shared(String targetId, String owner) {
            return new Plan(
                targetId,
                date,
                text,
                done,
                doneAt,
                createdAt,
                domain,
                updatedAt,
                deletedAt,
                null,
                owner
            );
        }

        /** 仅更新删除与同步时间，不改变原计划内容。 */
        public Plan tombstone(long now) {
            return new Plan(
                id,
                date,
                text,
                done,
                doneAt,
                createdAt,
                domain,
                now,
                now,
                shareWith,
                sharedBy
            );
        }
    }

    public record DayNote(
        String id,
        String date,
        String text,
        long createdAt,
        String domain,
        Number updatedAt,
        Number deletedAt,
        @JsonInclude(JsonInclude.Include.NON_NULL) List<String> shareWith,
        @JsonInclude(JsonInclude.Include.NON_NULL) String sharedBy
    ) implements SharedItem<DayNote> {
        /** 创建每日记录的接收方副本。 */
        public DayNote shared(String targetId, String owner) {
            return new DayNote(
                targetId,
                date,
                text,
                createdAt,
                domain,
                updatedAt,
                deletedAt,
                null,
                owner
            );
        }

        /** 创建记录的取消分享墓碑。 */
        public DayNote tombstone(long now) {
            return new DayNote(id, date, text, createdAt, domain, now, now, shareWith, sharedBy);
        }
    }

    public record Habit(
        String id,
        String text,
        String domain,
        long createdAt,
        Number archivedAt,
        List<String> checkIns,
        Number updatedAt,
        Number deletedAt
    ) implements SyncItem {
        /** 保留原习惯元数据，仅替换合并后的打卡集合。 */
        public Habit withCheckIns(List<String> dates) {
            return new Habit(id, text, domain, createdAt, archivedAt, dates, updatedAt, deletedAt);
        }
    }

    public record Birthday(String calendar, int month, int day, boolean leapMonth) {}

    public record Anniversary(
        String id,
        String name,
        String kind,
        String date,
        long createdAt,
        Number updatedAt,
        Number deletedAt,
        @JsonInclude(JsonInclude.Include.NON_NULL) Birthday birthday
    ) implements SyncItem {
        /** 为旧客户端未能表达的生日字段恢复已有规则，仍保留新名称及删除状态。 */
        public Anniversary withBirthday(Birthday rule) {
            return new Anniversary(id, name, kind, date, createdAt, updatedAt, deletedAt, rule);
        }
    }

    public record Reminder(
        String id,
        String text,
        String time,
        String mode,
        List<Integer> weekdays,
        long periodDays,
        String anchorDate,
        boolean enabled,
        long createdAt,
        Number updatedAt,
        Number deletedAt
    ) implements SyncItem {}

    public record Timeline(
        String id,
        String name,
        String date,
        long createdAt,
        Number updatedAt,
        Number deletedAt,
        @JsonInclude(JsonInclude.Include.NON_NULL) String startTime,
        @JsonInclude(JsonInclude.Include.NON_NULL) String endTime,
        @JsonInclude(JsonInclude.Include.NON_NULL) Boolean stepsMode,
        @JsonInclude(JsonInclude.Include.NON_NULL) String goalPlanId,
        @JsonInclude(JsonInclude.Include.NON_NULL) String domain,
        List<TimelineItem> items
    ) implements SyncItem {
        /** 判断时间线是否包含独立步骤，防止旧客户端覆盖新结构。 */
        public boolean hasSteps() {
            return items.stream().anyMatch(item -> item.step() != null);
        }
    }

    public record TimelineItem(
        String id,
        String planId,
        long durationMinutes,
        @JsonInclude(JsonInclude.Include.NON_NULL) Plan step
    ) {}

    public record City(String name, double lat, double lon) {}

    public record HomeCity(City city, Number updatedAt) {}
}
