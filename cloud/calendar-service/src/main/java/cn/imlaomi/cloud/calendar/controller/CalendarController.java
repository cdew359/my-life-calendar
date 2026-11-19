package cn.imlaomi.cloud.calendar.controller;

import cn.imlaomi.cloud.calendar.dto.*;
import cn.imlaomi.cloud.calendar.service.CalendarService;
import cn.imlaomi.cloud.common.config.ApiSecurity;
import org.springframework.web.bind.annotation.*;

/** 日历同步 HTTP 入口，不直接访问数据库。 */
@RestController
public class CalendarController {

    private final CalendarService service;

    /** 注入包含同步事务的日历业务。 */
    public CalendarController(CalendarService service) {
        this.service = service;
    }

    /** 读取当前账号日历。 */
    @GetMapping("/api/data")
    public CalendarStateResponse get(@RequestAttribute(ApiSecurity.ACCOUNT) String account) {
        return service.get(account);
    }

    /** 合并上传快照并分发共享计划。 */
    @PostMapping("/api/data")
    public CalendarStateResponse save(
        @RequestAttribute(ApiSecurity.ACCOUNT) String account,
        @RequestBody CalendarUploadRequest body
    ) {
        return service.save(account, body);
    }
}
