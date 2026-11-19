package cn.imlaomi.cloud.diary.entity;

/** 写入 ES 的文档协议；账号归属来自服务端鉴权后的业务上下文。 */
public record DiaryIndexDocument(
    String accountId,
    String date,
    int revision,
    boolean deleted,
    String title,
    String content
) {}
