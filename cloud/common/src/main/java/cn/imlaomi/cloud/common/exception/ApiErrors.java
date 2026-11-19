package cn.imlaomi.cloud.common.exception;

import cn.imlaomi.cloud.common.dto.ApiErrorResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class ApiErrors {

    /** 把可预期的业务异常转换为约定的 HTTP 状态和错误信息。 */
    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiErrorResponse> expected(ApiException e) {
        return ResponseEntity.status(e.status).body(new ApiErrorResponse(e.getMessage()));
    }

    /** 将无法解析的请求体或参数类型错误统一返回为 400。 */
    @ExceptionHandler({
        HttpMessageNotReadableException.class,
        MethodArgumentTypeMismatchException.class,
        tools.jackson.core.JacksonException.class,
    })
    ResponseEntity<ApiErrorResponse> malformed(Exception e) {
        // Jackson 会包装 DTO 反序列化期间的业务校验异常，恢复原有状态和错误信息。
        Throwable cause = e;
        for (int depth = 0; cause != null && depth < 20; depth++, cause = cause.getCause()) {
            if (cause instanceof ApiException expected) return expected(expected);
        }
        return ResponseEntity.badRequest().body(new ApiErrorResponse("请求格式错误"));
    }

    /** 对未预期异常返回通用 503，仅记录异常类型，避免泄露正文、密码或 SQL 参数。 */
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiErrorResponse> unavailable(Exception e) {
        // Never log request bodies, passwords, tokens, SQL parameters or diary text.
        System.err.println("Request failed: " + e.getClass().getSimpleName());
        return ResponseEntity.status(503).body(
            new ApiErrorResponse("服务暂时不可用，请保留本地数据后重试")
        );
    }
}
