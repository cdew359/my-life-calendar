package cn.imlaomi.cloud.calendar.service;

import cn.imlaomi.cloud.calendar.dto.*;
import cn.imlaomi.cloud.calendar.dto.CalendarData.*;
import java.util.*;

/** 类型安全的日历合并：保留旧协议的冲突、打卡、删除、生日和时间线保护规则。 */
public final class CalendarMerge {

    /** 合并同步快照，各业务集合保持自身的实体类型。 */
    public static CalendarData merge(CalendarUploadRequest request, CalendarData current) {
        CalendarData incoming = request.data();
        List<Timeline> lines = incoming
            .timelines()
            .stream()
            .map(line -> {
                Timeline stored = find(current.timelines(), line.id());
                var shape = request
                    .timelineShapes()
                    .stream()
                    .filter(s -> s.id().equals(line.id()))
                    .findFirst()
                    .orElse(null);
                if (stored == null || shape == null) return line;
                boolean oldSteps = Boolean.TRUE.equals(stored.stepsMode()) || stored.hasSteps();
                boolean emptySteps =
                    shape.stepsMode() &&
                    Boolean.TRUE.equals(stored.stepsMode()) &&
                    shape.emptyItems();
                if (
                    (oldSteps &&
                        (!shape.embeddedSteps() ||
                            (Boolean.TRUE.equals(stored.stepsMode()) && !shape.stepsMode())) &&
                        !emptySteps) ||
                    (stored.endTime() != null &&
                        !shape.deadlineProvided() &&
                        line.deletedAt() == null)
                ) return stored;
                return line;
            })
            .toList();
        List<Habit> habits = mergeItems(incoming.habits(), current.habits())
            .stream()
            .map(habit -> {
                Habit a = find(incoming.habits(), habit.id()),
                    b = find(current.habits(), habit.id());
                if (a == null || b == null) return habit;
                TreeSet<String> dates = new TreeSet<>();
                if (a.deletedAt() == null) dates.addAll(a.checkIns());
                if (b.deletedAt() == null) dates.addAll(b.checkIns());
                return habit.withCheckIns(List.copyOf(dates));
            })
            .toList();
        List<Anniversary> anniversaries = mergeItems(
            incoming.anniversaries(),
            current.anniversaries()
        )
            .stream()
            .map(ann -> {
                if (ann.birthday() != null) return ann;
                Anniversary a = find(incoming.anniversaries(), ann.id()),
                    b = find(current.anniversaries(), ann.id());
                Birthday rule =
                    a != null && a.birthday() != null
                        ? a.birthday()
                        : b == null
                          ? null
                          : b.birthday();
                return rule == null ? ann : ann.withBirthday(rule);
            })
            .toList();
        return new CalendarData(
            2,
            mergeItems(incoming.plans(), current.plans()),
            mergeItems(incoming.notes(), current.notes()),
            habits,
            anniversaries,
            mergeItems(incoming.reminders(), current.reminders()),
            mergeItems(lines, current.timelines()),
            city(incoming.homeCity(), current.homeCity()),
            city(incoming.watchCity(), current.watchCity())
        );
    }

    /** 按唯一标识合并同类型条目，时间相同优先墓碑，随后清理过期删除记录。 */
    private static <T extends SyncItem> List<T> mergeItems(List<T> incoming, List<T> current) {
        Map<String, T> merged = new LinkedHashMap<>();
        for (List<T> list : List.of(incoming, current))
            for (T item : list) {
                T old = merged.get(item.id());
                if (
                    old == null ||
                    effective(old) < effective(item) ||
                    (effective(old) == effective(item) && timestamp(old.deletedAt()) == 0)
                ) merged.put(item.id(), item);
            }
        long now = System.currentTimeMillis();
        return merged
            .values()
            .stream()
            .filter(
                item ->
                    item.deletedAt() == null || now - timestamp(item.deletedAt()) < 30L * 86400000
            )
            .toList();
    }

    /** 计算更新时间与删除时间中的较新值。 */
    private static long effective(SyncItem item) {
        return Math.max(timestamp(item.updatedAt()), timestamp(item.deletedAt()));
    }

    /** 沿用旧协议的毫秒时间比较方式，不把空值当作已删除。 */
    private static long timestamp(Number value) {
        return value == null ? 0 : value.longValue();
    }

    /** 从强类型集合中查找同标识条目。 */
    private static <T extends SyncItem> T find(List<T> items, String id) {
        return items
            .stream()
            .filter(item -> item.id().equals(id))
            .findFirst()
            .orElse(null);
    }

    /** 城市配置以更新时间较新者为准；相同时保留上传值。 */
    private static HomeCity city(HomeCity incoming, HomeCity current) {
        if (incoming == null) return current;
        if (current == null) return incoming;
        return timestamp(current.updatedAt()) > timestamp(incoming.updatedAt())
            ? current
            : incoming;
    }
}
