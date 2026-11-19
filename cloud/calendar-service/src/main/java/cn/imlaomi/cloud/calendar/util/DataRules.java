package cn.imlaomi.cloud.calendar.util;

import java.time.*;
import java.time.format.*;
import java.util.*;
import tools.jackson.databind.*;
import tools.jackson.databind.node.*;

/** 历史 JSON 协议的兼容清洗层；规范化后交给明确的日历 DTO 和合并服务。 */
public final class DataRules {

    static final ObjectMapper JSON = tools.jackson.databind.json.JsonMapper.builder().build();
    static final List<String> LISTS = List.of(
        "plans",
        "notes",
        "habits",
        "anniversaries",
        "reminders",
        "timelines"
    );

    /** 创建当前协议版本的空日历对象，补齐所有列表和城市字段。 */
    public static ObjectNode empty() {
        ObjectNode n = JSON.createObjectNode().put("version", 2);
        LISTS.forEach(k -> n.putArray(k));
        n.putNull("homeCity");
        n.putNull("watchCity");
        return n;
    }

    /** 判断 JSON 节点是否为格式和日历日期都合法的日期字符串。 */
    static boolean date(JsonNode n) {
        return n != null && n.isTextual() && validDate(n.asText());
    }

    /** 校验 YYYY-MM-DD 字符串是否对应真实日期，并拒绝零年份。 */
    public static boolean validDate(String value) {
        try {
            return (
                value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") &&
                !value.startsWith("0000") &&
                LocalDate.parse(value).toString().equals(value)
            );
        } catch (DateTimeException e) {
            return false;
        }
    }

    /** 校验 JSON 节点是否为合法的 24 小时制 HH:mm 时间。 */
    static boolean time(JsonNode n) {
        return n != null && n.isTextual() && n.asText().matches("([01][0-9]|2[0-3]):[0-5][0-9]");
    }

    /** 判断节点是否为有限数值，拒绝非数值和无穷值。 */
    static boolean number(JsonNode n) {
        return n != null && n.isNumber() && Double.isFinite(n.asDouble());
    }

    /** 读取数值时间戳，缺失或非法时按零处理。 */
    static long ts(JsonNode n) {
        return number(n) ? n.asLong() : 0;
    }

    /** 生成清洗缺少标识的条目时使用的唯一标识。 */
    static String id() {
        return UUID.randomUUID().toString();
    }

    /** 从节点读取文本，节点缺失时使用空字符串。 */
    static String text(JsonNode n) {
        return n == null ? "" : n.asText("");
    }

    /** 把字符串截断到指定最大长度。 */
    static String cut(String s, int length) {
        return s.substring(0, Math.min(s.length(), length));
    }

    /** 读取数组节点，类型不匹配时返回空数组。 */
    static ArrayNode array(JsonNode n) {
        return n instanceof ArrayNode a ? a : JSON.createArrayNode();
    }

    /** 复制合法的数值字段，非法或缺失时写入空值。 */
    static void copyNumber(ObjectNode target, JsonNode source, String key) {
        if (number(source.get(key))) target.set(key, source.get(key));
        else target.putNull(key);
    }

    /** 为条目补齐标识、创建时间、更新时间和删除标记等公共字段。 */
    static ObjectNode base(JsonNode row) {
        ObjectNode n = JSON.createObjectNode();
        n.put("id", row.path("id").isTextual() ? row.path("id").asText() : id());
        n.put(
            "createdAt",
            number(row.get("createdAt")) ? ts(row.get("createdAt")) : System.currentTimeMillis()
        );
        n.set(
            "updatedAt",
            number(row.get("updatedAt")) ? row.get("updatedAt") : n.get("createdAt")
        );
        copyNumber(n, row, "deletedAt");
        return n;
    }

    /** 将条目分类规范为工作或生活。 */
    static void domain(ObjectNode n, JsonNode row) {
        n.put("domain", "work".equals(row.path("domain").asText()) ? "work" : "life");
    }

    /** 清洗分享对象及来源账号，去重并限制分享数量。 */
    static void shares(ObjectNode n, JsonNode row) {
        if (row.path("shareWith").isArray()) {
            LinkedHashSet<String> names = new LinkedHashSet<>();
            row.path("shareWith").forEach(v -> {
                if (v.isTextual() && !v.asText().trim().isEmpty()) names.add(
                    cut(v.asText().trim(), 24)
                );
            });
            if (!names.isEmpty()) {
                ArrayNode a = n.putArray("shareWith");
                names.stream().limit(8).forEach(a::add);
            }
        }
        if (
            row.path("sharedBy").isTextual() && !row.path("sharedBy").asText().trim().isEmpty()
        ) n.put("sharedBy", cut(row.path("sharedBy").asText().trim(), 24));
    }

    /** 校验公历或农历生日规则，保留小月及缺少闰月时由客户端换算的月日信息。 */
    private static ObjectNode birthday(JsonNode b) {
        String calendar = b.path("calendar").asText();
        if (!calendar.equals("solar") && !calendar.equals("lunar")) return null;
        if (!b.path("month").isIntegralNumber() || !b.path("day").isIntegralNumber()) return null;
        if (!b.path("month").canConvertToInt() || !b.path("day").canConvertToInt()) return null;
        int month = b.path("month").asInt(),
            day = b.path("day").asInt();
        if (month < 1 || month > 12 || day < 1) return null;
        if (
            day > (calendar.equals("lunar") ? 30 : YearMonth.of(2000, month).lengthOfMonth())
        ) return null;
        return JSON.createObjectNode()
            .put("calendar", calendar)
            .put("month", month)
            .put("day", day)
            .put(
                "leapMonth",
                calendar.equals("lunar") &&
                    b.path("leapMonth").isBoolean() &&
                    b.path("leapMonth").asBoolean()
            );
    }

    /** 清洗日历各类数据并兼容旧字段，保持与原 TypeScript 后端相同的处理规则。 */
    public static ObjectNode coerce(JsonNode raw) {
        ObjectNode result = empty();
        for (String key : LISTS) {
            if (key.equals("timelines")) continue;
            for (JsonNode row : array(raw == null ? null : raw.get(key))) {
                if (!row.isObject()) continue;
                String field = key.equals("anniversaries") ? "name" : "text";
                if (!row.path(field).isTextual()) continue;
                if (
                    List.of("plans", "notes", "anniversaries").contains(key) &&
                    !date(row.get("date"))
                ) continue;
                if (
                    List.of("plans", "notes").contains(key) &&
                    row.path(field).asText().trim().isEmpty()
                ) continue;
                if (key.equals("plans") && !row.path("id").isTextual()) continue;
                if (key.equals("reminders") && !time(row.get("time"))) continue;
                ObjectNode n = base(row);
                n.put(field, row.path(field).asText().trim());
                switch (key) {
                    case "plans", "notes" -> {
                        n.set("date", row.get("date"));
                        domain(n, row);
                        shares(n, row);
                        if (key.equals("plans")) {
                            n.put(
                                "done",
                                row.path("done").isBoolean() && row.path("done").asBoolean()
                            );
                            copyNumber(n, row, "doneAt");
                        }
                    }
                    case "habits" -> {
                        domain(n, row);
                        copyNumber(n, row, "archivedAt");
                        ArrayList<String> checks = new ArrayList<>();
                        array(row.get("checkIns")).forEach(v -> {
                            if (date(v)) checks.add(v.asText());
                        });
                        Collections.sort(checks);
                        ArrayNode a = n.putArray("checkIns");
                        checks.forEach(a::add);
                    }
                    case "anniversaries" -> {
                        n.set("date", row.get("date"));
                        n.put("kind", row.path("kind").asText().equals("once") ? "once" : "yearly");
                        ObjectNode birthday = birthday(row.path("birthday"));
                        if (birthday != null) n.set("birthday", birthday);
                    }
                    case "reminders" -> {
                        boolean periodic = row.path("mode").asText().equals("periodic");
                        n.set("time", row.get("time"));
                        n.put("mode", periodic ? "periodic" : "weekly");
                        TreeSet<Integer> days = new TreeSet<>();
                        array(row.get("weekdays")).forEach(v -> {
                            try {
                                double x = Double.parseDouble(v.asText());
                                if (x >= 1 && x <= 7 && x == Math.floor(x)) days.add((int) x);
                            } catch (Exception ignored) {}
                        });
                        if (periodic || days.isEmpty()) {
                            days.clear();
                            days.addAll(List.of(1, 2, 3, 4, 5));
                        }
                        ArrayNode a = n.putArray("weekdays");
                        days.forEach(a::add);
                        long period = row.path("periodDays").asLong();
                        n.put("periodDays", period >= 1 ? period : 1);
                        n.put(
                            "anchorDate",
                            date(row.get("anchorDate"))
                                ? row.path("anchorDate").asText()
                                : "2026-01-01"
                        );
                        n.put(
                            "enabled",
                            !row.path("enabled").isBoolean() || row.path("enabled").asBoolean()
                        );
                    }
                }
                ((ArrayNode) result.get(key)).add(n);
            }
        }
        Map<String, ObjectNode> lines = new LinkedHashMap<>();
        for (JsonNode row : array(raw == null ? null : raw.get("timelines"))) {
            try {
                ObjectNode n = timeline(row, result.path("plans"));
                lines.put(n.path("id").asText(), n);
            } catch (IllegalArgumentException ignored) {}
        }
        lines.values().forEach(n -> ((ArrayNode) result.get("timelines")).add(n));
        for (String key : List.of("homeCity", "watchCity")) {
            JsonNode row = raw == null ? null : raw.get(key),
                city = row == null ? null : row.get("city");
            if (
                city == null ||
                !city.path("name").isTextual() ||
                city.path("name").asText().trim().isEmpty()
            ) continue;
            try {
                double lat = Double.parseDouble(city.path("lat").asText()),
                    lon = Double.parseDouble(city.path("lon").asText());
                if (
                    !Double.isFinite(lat) ||
                    !Double.isFinite(lon) ||
                    Math.abs(lat) > 90 ||
                    Math.abs(lon) > 180
                ) continue;
                ObjectNode n = JSON.createObjectNode();
                n.putObject("city")
                    .put("name", cut(city.path("name").asText().trim(), 24))
                    .put("lat", lat)
                    .put("lon", lon);
                n.put("updatedAt", ts(row.get("updatedAt")));
                result.set(key, n);
            } catch (NumberFormatException ignored) {}
        }
        return result;
    }

    /** 校验条件不满足时抛出可向客户端说明原因的业务异常。 */
    static void require(boolean value) {
        if (!value) throw new IllegalArgumentException("Invalid timeline");
    }

    /** 校验和规范单条时间线，保留倒推模式、步骤与最终目标的关联。 */
    static ObjectNode timeline(JsonNode row, JsonNode plans) {
        require(
            row.isObject() &&
                row.path("id").isTextual() &&
                !row.path("id").asText().isEmpty() &&
                row.path("name").isTextual()
        );
        require(
            !row.path("name").asText().trim().isEmpty() &&
                row.path("name").asText().length() <= 100 &&
                row.path("items").isArray()
        );
        require(
            date(row.get("date")) &&
                number(row.get("createdAt")) &&
                number(row.get("updatedAt")) &&
                (row.path("deletedAt").isNull() || number(row.get("deletedAt")))
        );
        boolean backward = row.has("endTime"),
            stepsMode = row.path("stepsMode").isBoolean() && row.path("stepsMode").asBoolean();
        require(time(row.get(backward ? "endTime" : "startTime")));
        if (row.has("goalPlanId")) require(
            row
                .path("goalPlanId")
                .asText()
                .equals("timeline-goal:" + row.path("id").asText())
        );
        ObjectNode n = base(row);
        n.put("name", row.path("name").asText().trim());
        n.set("date", row.get("date"));
        if (row.has("startTime")) n.set("startTime", row.get("startTime"));
        if (backward) n.set("endTime", row.get("endTime"));
        if (stepsMode) n.put("stepsMode", true);
        if (row.hasNonNull("goalPlanId") && !row.path("goalPlanId").asText().isEmpty()) n.set(
            "goalPlanId",
            row.get("goalPlanId")
        );
        if (Set.of("work", "life").contains(row.path("domain").asText())) n.set(
            "domain",
            row.get("domain")
        );
        LocalDateTime cursor = LocalDate.parse(row.path("date").asText()).atTime(
            LocalTime.parse(row.path(backward ? "endTime" : "startTime").asText())
        );
        long forwardDuration = 0;
        Set<String> ids = new HashSet<>(),
            pids = new HashSet<>();
        ArrayNode items = n.putArray("items");
        for (JsonNode item : row.path("items")) {
            require(
                item.path("id").isTextual() &&
                    !item.path("id").asText().isEmpty() &&
                    item.path("planId").isTextual() &&
                    !item.path("planId").asText().isEmpty()
            );
            require(ids.add(item.path("id").asText()) && pids.add(item.path("planId").asText()));
            double minutes = item.path("durationMinutes").asDouble();
            require(
                number(item.get("durationMinutes")) &&
                    minutes >= 1 &&
                    minutes == Math.floor(minutes) &&
                    minutes <= 9007199254740991d
            );
            JsonNode step = item.get("step");
            if (stepsMode) require(step != null && step.isObject());
            ObjectNode dest = items.addObject();
            dest.set("id", item.get("id"));
            dest.set("planId", item.get("planId"));
            dest.set("durationMinutes", item.get("durationMinutes"));
            if (step != null && !step.isNull() && !step.isBoolean()) {
                require(
                    step.path("id").equals(item.get("planId")) &&
                        step.path("text").isTextual() &&
                        !step.path("text").asText().trim().isEmpty() &&
                        step.path("text").asText().length() <= 500
                );
                require(
                    Set.of("work", "life").contains(step.path("domain").asText()) &&
                        step.path("done").isBoolean() &&
                        step.path("deletedAt").isNull() &&
                        number(step.get("createdAt")) &&
                        number(step.get("updatedAt")) &&
                        (step.path("doneAt").isNull() || number(step.get("doneAt")))
                );
                ObjectNode s = base(step);
                s.set("date", row.get("date"));
                s.put("text", step.path("text").asText().trim());
                s.set("domain", step.get("domain"));
                s.set("done", step.get("done"));
                copyNumber(s, step, "doneAt");
                dest.set("step", s);
            }
            try {
                cursor = cursor.plusMinutes(backward ? -((long) minutes) : (long) minutes);
            } catch (DateTimeException | ArithmeticException e) {
                throw new IllegalArgumentException("Timeline out of range");
            }
            require(cursor.getYear() >= 1 && cursor.getYear() <= 9999);
            boolean alive = false;
            for (JsonNode p : plans)
                if (p.path("id").equals(item.get("planId")) && p.path("deletedAt").isNull()) alive =
                    true;
            if (alive) forwardDuration = Math.addExact(forwardDuration, (long) minutes);
        }
        if (!backward) {
            LocalDateTime deadline = LocalDate.parse(row.path("date").asText())
                .atTime(LocalTime.parse(row.path("startTime").asText()))
                .plusMinutes(forwardDuration);
            require(deadline.getYear() >= 1 && deadline.getYear() <= 9999);
            n.put("date", deadline.toLocalDate().toString());
            n.put("endTime", deadline.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm")));
        }
        return n;
    }

    /** 判断时间线是否使用独立步骤或最终目标关联，以识别旧客户端无法表达的新结构。 */
    static boolean hasSteps(JsonNode n) {
        for (JsonNode i : array(n.get("items"))) if (i.hasNonNull("step")) return true;
        return false;
    }
}
