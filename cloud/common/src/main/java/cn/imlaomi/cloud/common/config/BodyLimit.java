package cn.imlaomi.cloud.common.config;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.util.*;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.*;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
public class BodyLimit {

    /** 注册请求体大小限制过滤器，防止过大的上传占用内存。 */
    @Bean
    FilterRegistrationBean<OncePerRequestFilter> boundedRequestFilter() {
        var registration = new FilterRegistrationBean<OncePerRequestFilter>();
        registration.setOrder(0);
        registration.setFilter(
            new OncePerRequestFilter() {
                /** 读取并限制请求体大小，超过上限时返回 413，否则包装成可继续读取的请求。 */
                @Override
                protected void doFilterInternal(
                    HttpServletRequest request,
                    HttpServletResponse response,
                    FilterChain chain
                ) throws IOException, ServletException {
                    if (!Set.of("POST", "PUT", "DELETE").contains(request.getMethod())) {
                        chain.doFilter(request, response);
                        return;
                    }
                    int max = request.getRequestURI().startsWith("/api/diaries/")
                        ? 128 * 1024
                        : 2 * 1024 * 1024;
                    byte[] body = request.getInputStream().readNBytes(max + 1);
                    if (body.length > max) {
                        response.setStatus(413);
                        response.setContentType("application/json;charset=UTF-8");
                        response.getWriter().write("{\"error\":\"数据过大\"}");
                        return;
                    }
                    var input = new ByteArrayInputStream(body);
                    chain.doFilter(
                        new HttpServletRequestWrapper(request) {
                            /** 为已读取的请求体创建供下游处理器使用的输入流。 */
                            @Override
                            public ServletInputStream getInputStream() {
                                return new ServletInputStream() {
                                    /** 读取请求体中的下一个字节。 */
                                    public int read() {
                                        return input.read();
                                    }

                                    /** 将请求体数据读取到指定字节数组区间。 */
                                    public int read(byte[] b, int o, int len) {
                                        return input.read(b, o, len);
                                    }

                                    /** 判断缓存请求体是否已全部读取。 */
                                    public boolean isFinished() {
                                        return input.available() == 0;
                                    }

                                    /** 表明内存中的请求体可以立即读取。 */
                                    public boolean isReady() {
                                        return true;
                                    }

                                    /** 当前缓存流仅支持同步读取；调用异步监听接口时明确拒绝。 */
                                    public void setReadListener(ReadListener listener) {
                                        throw new UnsupportedOperationException();
                                    }
                                };
                            }

                            /** 以 UTF-8 字符流形式读取缓存请求体。 */
                            @Override
                            public BufferedReader getReader() {
                                return new BufferedReader(
                                    new InputStreamReader(
                                        getInputStream(),
                                        java.nio.charset.StandardCharsets.UTF_8
                                    )
                                );
                            }
                        },
                        response
                    );
                }
            }
        );
        return registration;
    }
}
