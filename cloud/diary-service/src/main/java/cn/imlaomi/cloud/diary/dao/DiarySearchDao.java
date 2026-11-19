package cn.imlaomi.cloud.diary.dao;

import cn.imlaomi.cloud.common.exception.ApiException;
import cn.imlaomi.cloud.diary.dto.DiarySearchResult;
import cn.imlaomi.cloud.diary.entity.DiaryEntryEntity;
import cn.imlaomi.cloud.diary.entity.DiaryIndexDocument;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.*;
import tools.jackson.databind.node.ObjectNode;

@Repository
public class DiarySearchDao {

    /** RAG 使用宽松关键词召回；普通搜索的原有 AND 语义保持不变。 */
    public DiarySearchResult retrieve(String account, String keyword, String from, String to) {
        ensure();
        var body = query(account, keyword, from, to, 1);
        ((ObjectNode) body.at("/query/bool/must/0/multi_match"))
            .put("operator", "or")
            .put("minimum_should_match", "30%");
        var response = call("/_search", "POST", body);
        if (response.statusCode() != 200) throw unavailable();
        try {
            JsonNode hits = json.readTree(response.body()).path("hits");
            List<DiarySearchResult.Hit> result = new ArrayList<>();
            for (JsonNode hit : hits.path("hits"))
                result.add(
                    new DiarySearchResult.Hit(
                        hit.at("/_source/date").asText(),
                        hit.at("/_source/revision").asInt()
                    )
                );
            return new DiarySearchResult(hits.at("/total/value").asLong(), List.copyOf(result));
        } catch (Exception failure) {
            throw unavailable();
        }
    }

    private final String url, index;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(3))
        .build();

    /** 校验索引名并初始化 Elasticsearch 地址与 JSON 转换工具。 */
    public DiarySearchDao(
        @Value("${cloud.elasticsearch-url}") String url,
        @Value("${cloud.diary-index}") String index,
        ObjectMapper json
    ) {
        if (!index.matches("[a-z][a-z0-9_-]{2,100}")) throw new IllegalArgumentException(
            "Invalid diary index"
        );
        this.url = url.replaceAll("/+$", "");
        this.index = index;
        this.json = json;
    }

    /** 向当前日记索引发送带超时的 HTTP 请求，失败时转换为搜索不可用错误。 */
    HttpResponse<String> call(String path, String method, JsonNode body) {
        try {
            var request = HttpRequest.newBuilder(URI.create(url + "/" + index + path))
                .timeout(Duration.ofSeconds(4))
                .header("Content-Type", "application/json")
                .method(
                    method,
                    body == null
                        ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))
                )
                .build();
            return http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw unavailable();
        }
    }

    /** 创建搜索暂时不可用的提示，明确日记仍可独立保存。 */
    ApiException unavailable() {
        return new ApiException(503, "搜索服务暂时不可用，日记保存不受影响，请稍后重试");
    }

    /** 检查并按需创建带中文分词映射的索引，返回是否由本次请求新建。 */
    public synchronized boolean ensure() {
        var head = call("", "HEAD", null);
        if (head.statusCode() == 200) return false;
        if (head.statusCode() != 404) throw unavailable();
        var created = call(
            "",
            "PUT",
            json.valueToTree(
                Map.of(
                    "settings",
                    Map.of("number_of_shards", 1, "number_of_replicas", 0),
                    "mappings",
                    Map.of(
                        "dynamic",
                        "strict",
                        "properties",
                        Map.of(
                            "accountId",
                            Map.of("type", "keyword"),
                            "date",
                            Map.of("type", "date"),
                            "revision",
                            Map.of("type", "long"),
                            "deleted",
                            Map.of("type", "boolean"),
                            "title",
                            Map.of("type", "text", "analyzer", "cjk"),
                            "content",
                            Map.of("type", "text", "analyzer", "cjk")
                        )
                    )
                )
            )
        );
        if (
            created.statusCode() != 200 &&
            !created.body().contains("resource_already_exists_exception")
        ) throw unavailable();
        return created.statusCode() == 200;
    }

    /** 使用账号与日期生成文档标识，并按外部版本号写入正文或删除状态，避免旧任务覆盖新版本。 */
    public void put(String account, DiaryEntryEntity e) {
        try {
            String id = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(json.writeValueAsBytes(List.of(account, e.date())));
            var r = call(
                "/_doc/" +
                    id +
                    "?version=" +
                    e.revision() +
                    "&version_type=external_gte&refresh=wait_for",
                "PUT",
                json.valueToTree(
                    new DiaryIndexDocument(
                        account,
                        e.date(),
                        e.revision(),
                        e.deleted(),
                        e.deleted() ? "" : e.title(),
                        e.deleted() ? "" : e.content()
                    )
                )
            );
            if (
                r.statusCode() != 200 && r.statusCode() != 201 && r.statusCode() != 409
            ) throw unavailable();
        } catch (tools.jackson.core.JacksonException ex) {
            throw unavailable();
        }
    }

    /** 构造固定账号隔离、排除删除记录并带日期范围和分页的关键词搜索请求。 */
    public static ObjectNode query(
        String account,
        String keyword,
        String from,
        String to,
        int page
    ) {
        ObjectNode body = tools.jackson.databind.json.JsonMapper.builder()
            .build()
            .createObjectNode();
        body.put("from", (page - 1) * 20)
            .put("size", 20)
            .put("track_total_hits", true);
        ObjectNode bool = body.putObject("query").putObject("bool");
        var filter = bool.putArray("filter");
        filter.addObject().putObject("term").put("accountId", account);
        filter.addObject().putObject("term").put("deleted", false);
        if (!from.isEmpty() || !to.isEmpty()) {
            ObjectNode range = filter.addObject().putObject("range").putObject("date");
            if (!from.isEmpty()) range.put("gte", from);
            if (!to.isEmpty()) range.put("lte", to);
        }
        ObjectNode match = bool.putArray("must").addObject().putObject("multi_match");
        match.put("query", keyword).put("operator", "and");
        match.putArray("fields").add("title^3").add("content");
        body.putArray("sort").add("_score").addObject().put("date", "desc");
        body.putArray("_source").add("date").add("revision");
        return body;
    }

    /** 执行账号隔离的关键词搜索，并返回供数据库回查的命中日期和版本。 */
    public DiarySearchResult search(
        String account,
        String keyword,
        String from,
        String to,
        int page
    ) {
        ensure();
        var r = call("/_search", "POST", query(account, keyword, from, to, page));
        if (r.statusCode() != 200) throw unavailable();
        try {
            JsonNode hits = json.readTree(r.body()).path("hits");
            List<DiarySearchResult.Hit> result = new ArrayList<>();
            for (JsonNode hit : hits.path("hits"))
                result.add(
                    new DiarySearchResult.Hit(
                        hit.path("_source").path("date").asText(),
                        hit.path("_source").path("revision").asInt()
                    )
                );
            return new DiarySearchResult(hits.path("total").path("value").asLong(), result);
        } catch (Exception e) {
            throw unavailable();
        }
    }
}
