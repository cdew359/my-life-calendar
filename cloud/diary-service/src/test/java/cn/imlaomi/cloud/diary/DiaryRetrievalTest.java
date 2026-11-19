package cn.imlaomi.cloud.diary;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cn.imlaomi.cloud.common.dto.KnowledgeDtos.*;
import cn.imlaomi.cloud.diary.dao.DiarySearchDao;
import cn.imlaomi.cloud.diary.dto.DiarySearchResult;
import cn.imlaomi.cloud.diary.entity.DiaryEntryEntity;
import cn.imlaomi.cloud.diary.service.*;
import java.util.List;
import org.junit.jupiter.api.Test;

class DiaryRetrievalTest {

    /** ES 旧索引不能成为证据，正文只能从当前账号的权威存储获取。 */
    @Test
    void filtersStaleDeletedAndWrongAccount() {
        var search = mock(DiarySearchDao.class);
        var entries = mock(DiaryEntryService.class);
        var service = new DiaryRetrievalService(search, entries);
        when(search.retrieve("alice", "项目", "2026-11-01", "2026-11-30")).thenReturn(
            new DiarySearchResult(
                3,
                List.of(
                    new DiarySearchResult.Hit("2026-11-17", 1),
                    new DiarySearchResult.Hit("2026-11-18", 1),
                    new DiarySearchResult.Hit("2026-11-19", 2)
                )
            )
        );
        when(entries.get("alice", "2026-11-17")).thenReturn(
            new DiaryEntryEntity("2026-11-17", "旧", "旧版", 2, 1, 2, false)
        );
        when(entries.get("alice", "2026-11-18")).thenReturn(
            new DiaryEntryEntity("2026-11-18", "删除", "不应返回", 1, 1, 2, true)
        );
        when(entries.get("alice", "2026-11-19")).thenReturn(
            new DiaryEntryEntity("2026-11-19", "项目", "我的项目记录", 2, 1, 2, false)
        );
        var result = service.retrieve(
            "alice",
            new Search("怎么办", "项目", "2026-11-01", "2026-11-30")
        );
        assertThat(result.indexing()).isTrue();
        assertThat(result.items()).hasSize(1);
        assertThat(result.items().get(0).excerpt()).isEqualTo("我的项目记录");
        var references = new References(result.items());
        assertThat(service.verify("alice", references).valid()).isTrue();
        assertThat(service.verify("bob", references).valid()).isFalse();
        when(entries.get("alice", "2026-11-19")).thenReturn(
            new DiaryEntryEntity("2026-11-19", "项目", "更新", 3, 1, 3, false)
        );
        assertThat(service.verify("alice", references).valid()).isFalse();
    }
}
