package cn.imlaomi.cloud.common.dto;

import java.util.List;

/** 日记服务向 AI 提供的最小、可校验的证据协议。 */
public final class KnowledgeDtos {

    public record Search(String question, String keywords, String from, String to) {}

    public record Evidence(String id, String date, String title, String excerpt, int revision) {}

    public record EvidenceResponse(List<Evidence> items, boolean indexing) {}

    public record References(List<Evidence> sources) {}

    public record Verification(boolean valid) {}
}
