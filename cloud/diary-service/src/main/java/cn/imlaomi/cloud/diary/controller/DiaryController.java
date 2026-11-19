package cn.imlaomi.cloud.diary.controller;

import cn.imlaomi.cloud.common.config.ApiSecurity;
import cn.imlaomi.cloud.diary.dto.DiaryDtos.*;
import cn.imlaomi.cloud.diary.service.DiaryService;
import org.springframework.web.bind.annotation.*;

/** 日记 HTTP 入口，将账号上下文交给业务层。 */
@RestController
public class DiaryController {

    private final DiaryService service;

    /** 注入日记应用业务。 */
    public DiaryController(DiaryService service) {
        this.service = service;
    }

    /** 读取一天的日记。 */
    @GetMapping("/api/diaries/entries/{date}")
    public GetDiaryResponse get(
        @RequestAttribute(ApiSecurity.ACCOUNT) String account,
        @PathVariable String date
    ) {
        return service.get(account, date);
    }

    /** 保存日记并创建持久化索引任务。 */
    @PutMapping("/api/diaries/entries/{date}")
    public SaveDiaryResponse save(
        @RequestAttribute(ApiSecurity.ACCOUNT) String account,
        @PathVariable String date,
        @RequestBody SaveDiaryRequest body
    ) {
        return service.save(account, date, body);
    }

    /** 按预期版本删除日记。 */
    @DeleteMapping("/api/diaries/entries/{date}")
    public DeleteDiaryResponse delete(
        @RequestAttribute(ApiSecurity.ACCOUNT) String account,
        @PathVariable String date,
        @RequestBody DeleteDiaryRequest body
    ) {
        return service.delete(account, date, body);
    }

    /** 按关键词及日期范围查询当前账号日记。 */
    @GetMapping("/api/diaries/search")
    public SearchDiaryResponse search(
        @RequestAttribute(ApiSecurity.ACCOUNT) String account,
        @RequestParam(defaultValue = "") String q,
        @RequestParam(defaultValue = "") String from,
        @RequestParam(defaultValue = "") String to,
        @RequestParam(defaultValue = "1") int page
    ) {
        return service.search(account, q, from, to, page);
    }

    /** 校验内部密钥并重建索引任务。 */
    @PostMapping("/internal/diaries/reindex")
    public ReindexResponse reindex(
        @RequestHeader(value = "X-Internal-Key", required = false) String key
    ) {
        return service.reindex(key);
    }
}
