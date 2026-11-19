package cn.imlaomi.cloud.diary;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cn.imlaomi.cloud.common.config.ApiSecurity;
import cn.imlaomi.cloud.common.exception.ApiErrors;
import cn.imlaomi.cloud.diary.controller.DiaryController;
import cn.imlaomi.cloud.diary.dao.DiarySearchDao;
import cn.imlaomi.cloud.diary.dto.DiarySearchResult;
import cn.imlaomi.cloud.diary.entity.DiaryEntryEntity;
import cn.imlaomi.cloud.diary.service.DiaryEntryService;
import cn.imlaomi.cloud.diary.service.DiaryService;
import cn.imlaomi.cloud.diary.service.IndexWorker;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class DiaryDtoTest {

    /** 验证 DTO 版本与正文校验在 HTTP 层仍返回原业务错误，合法请求正常传入类型明确的存储调用。 */
    @Test
    void validatesRequestsThroughMvc() throws Exception {
        var store = mock(DiaryEntryService.class);
        var controller = new DiaryController(
            new DiaryService(store, mock(DiarySearchDao.class), mock(IndexWorker.class), "key")
        );
        var mvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new ApiErrors())
            .build();
        mvc.perform(
            put("/api/diaries/entries/2026-11-18")
                .requestAttr(ApiSecurity.ACCOUNT, "owner")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"\",\"content\":\"text\",\"expectedRevision\":\"0\"}")
        )
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("版本号无效"));
        mvc.perform(
            put("/api/diaries/entries/2026-11-18")
                .requestAttr(ApiSecurity.ACCOUNT, "owner")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"\",\"content\":\" \",\"expectedRevision\":0}")
        )
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("标题最多100字，正文1～20000字"));
        verifyNoInteractions(store);
        when(store.write("owner", "2026-11-18", "title", " text ", 0, false)).thenReturn(
            new DiaryEntryEntity("2026-11-18", "title", " text ", 1, 10, 10, false)
        );
        mvc.perform(
            put("/api/diaries/entries/2026-11-18")
                .requestAttr(ApiSecurity.ACCOUNT, "owner")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\" title \",\"content\":\" text \",\"expectedRevision\":0}")
        )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.entry.revision").value(1))
            .andExpect(jsonPath("$.searchPending").value(true));
        verify(store).write("owner", "2026-11-18", "title", " text ", 0, false);
    }

    /** 验证删除版本与空 entry 保持原约定，ES 旧版本及已删除命中不会出现在搜索结果。 */
    @Test
    void preservesDeletionAndRechecksTypedSearchHits() throws Exception {
        var store = mock(DiaryEntryService.class);
        var index = mock(DiarySearchDao.class);
        var controller = new DiaryController(
            new DiaryService(store, index, mock(IndexWorker.class), "key")
        );
        var mvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new ApiErrors())
            .build();
        when(store.get("owner", "2026-11-18")).thenReturn(
            new DiaryEntryEntity("2026-11-18", "", "", 3, 1, 2, true)
        );
        mvc.perform(
            get("/api/diaries/entries/2026-11-18").requestAttr(ApiSecurity.ACCOUNT, "owner")
        )
            .andExpect(status().isOk())
            .andExpect(content().json("{\"entry\":null,\"revision\":3}"));
        when(store.get("owner", "2026-11-17")).thenReturn(
            new DiaryEntryEntity("2026-11-17", "new", "text", 2, 1, 2, false)
        );
        when(store.get("owner", "2026-11-16")).thenReturn(
            new DiaryEntryEntity("2026-11-16", "valid", "text", 1, 1, 1, false)
        );
        when(index.search("owner", "text", "", "", 1)).thenReturn(
            new DiarySearchResult(
                3,
                List.of(
                    new DiarySearchResult.Hit("2026-11-18", 3),
                    new DiarySearchResult.Hit("2026-11-17", 1),
                    new DiarySearchResult.Hit("2026-11-16", 1)
                )
            )
        );
        var response = controller.search("owner", "text", "", "", 1);
        assertThat(response.items())
            .extracting(item -> item.date())
            .containsExactly("2026-11-16");
        assertThat(response.total()).isEqualTo(3);
        assertThat(response.pageSize()).isEqualTo(20);
        assertThat(response.indexing()).isTrue();
        verify(store, never()).get(eq("someone-else"), anyString());
    }
}
