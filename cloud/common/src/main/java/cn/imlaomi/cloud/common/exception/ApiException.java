package cn.imlaomi.cloud.common.exception;

public class ApiException extends RuntimeException {

    public final int status;

    /** 记录业务异常的 HTTP 状态码及可向客户端展示的信息。 */
    public ApiException(int status, String message) {
        super(message);
        this.status = status;
    }
}
