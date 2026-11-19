package cn.imlaomi.cloud.calendar.service;

import cn.imlaomi.cloud.calendar.client.UserClient;
import cn.imlaomi.cloud.calendar.dao.CalendarStateDao;
import cn.imlaomi.cloud.calendar.dto.*;
import cn.imlaomi.cloud.calendar.dto.CalendarData.*;
import cn.imlaomi.cloud.calendar.entity.CalendarStateEntity;
import cn.imlaomi.cloud.calendar.util.CalendarJson;
import cn.imlaomi.cloud.common.dto.AccountSummary;
import cn.imlaomi.cloud.common.exception.ApiException;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class CalendarService {

    private final CalendarStateDao calendarStateDao;
    private final UserClient users;
    private final ObjectMapper json;

    /** 注入日历存储、强类型用户客户端和持久化 JSON 边界工具。 */
    public CalendarService(CalendarStateDao calendarStateDao, UserClient users, ObjectMapper json) {
        this.calendarStateDao = calendarStateDao;
        this.users = users;
        this.json = json;
    }

    /** 从 JSON 存储边界解码为日历业务快照，首次使用时返回完整空对象。 */
    CalendarStateResponse read(String account) {
        CalendarStateEntity row = calendarStateDao.find(account);
        if (row == null) return new CalendarStateResponse(0, CalendarJson.read(null));
        try {
            return new CalendarStateResponse(
                row.version(),
                CalendarJson.read(json.readTree(row.payload()))
            );
        } catch (Exception failure) {
            throw new IllegalStateException("Stored calendar is invalid", failure);
        }
    }

    /** 只在数据库边界序列化日历 DTO，保留原 JSON 文档表及事务结构。 */
    void write(String account, CalendarStateResponse state) {
        calendarStateDao.upsert(
            new CalendarStateEntity(account, state.version(), CalendarJson.write(state.data()))
        );
    }

    /** 返回当前账号的类型明确且不包含其他账号私有数据的日历响应。 */

    public CalendarStateResponse get(String account) {
        return read(account);
    }

    /** 合并经过兼容清洗的上传 DTO，在原有跨后端锁和同一事务内分发分享。 */

    @Transactional
    public CalendarStateResponse save(String account, CalendarUploadRequest body) {
        List<AccountSummary> accounts = users.accounts();
        AccountSummary self = accounts
            .stream()
            .filter(a -> a.id().equals(account))
            .findFirst()
            .orElseThrow(() -> new ApiException(401, "账号不存在"));
        calendarStateDao.lockCalendar();
        CalendarStateResponse current = read(account);
        CalendarStateResponse state = new CalendarStateResponse(
            Math.max(System.currentTimeMillis(), current.version() + 1),
            CalendarMerge.merge(body, current.data())
        );
        write(account, state);
        for (AccountSummary other : accounts) {
            if (other.id().equals(account)) continue;
            CalendarStateResponse theirs = read(other.id());
            CalendarData target = theirs
                .data()
                .withSharedEntries(
                    share(
                        self.username(),
                        other.username(),
                        state.data().plans(),
                        theirs.data().plans()
                    ),
                    share(
                        self.username(),
                        other.username(),
                        state.data().notes(),
                        theirs.data().notes()
                    )
                );
            if (!target.equals(theirs.data())) write(
                other.id(),
                new CalendarStateResponse(
                    Math.max(System.currentTimeMillis(), theirs.version() + 1),
                    target
                )
            );
        }
        return state;
    }

    /** 按同一实体类型分发分享，保留接收方已删除副本及取消分享的墓碑规则。 */
    public static <T extends SharedItem<T>> List<T> share(
        String owner,
        String recipient,
        List<T> source,
        List<T> target
    ) {
        Map<String, T> wanted = new LinkedHashMap<>();
        for (T item : source) {
            if (
                item.deletedAt() == null &&
                item.shareWith() != null &&
                item.shareWith().contains(recipient)
            ) wanted.put(item.id() + "@" + owner, item);
        }
        List<T> result = new ArrayList<>(target);
        long now = System.currentTimeMillis();
        for (int i = 0; i < result.size(); i++) {
            T item = result.get(i);
            if (!owner.equals(item.sharedBy())) continue;
            T latest = wanted.remove(item.id());
            if (latest == null) {
                if (item.deletedAt() == null) result.set(i, item.tombstone(now));
            } else if (
                item.deletedAt() == null &&
                latest.updatedAt().longValue() > item.updatedAt().longValue()
            ) {
                result.set(i, latest.shared(item.id(), owner));
            }
        }
        wanted.forEach((id, latest) -> result.add(latest.shared(id, owner)));
        return List.copyOf(result);
    }
}
