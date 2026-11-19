import { createRoot } from "react-dom/client";
import AiPanel from "../../src/components/AiPanel";
import { saveSyncConfig } from "../../src/lib/syncEngine";
import type { AiPlanBatch } from "../../src/lib/aiPlans";
import "../../src/styles.css";
import "../../src/storybook.css";
import "../../src/components/diary.css";

declare global {
  interface Window {
    aiFixture: {
      calls: number;
      fail: boolean;
      saved: AiPlanBatch[];
      opened: string;
      delay: boolean;
      /** 手动释放待返回的模拟结果，检查关闭和账号变化。 */
      release?: () => void;
    };
  }
}
window.aiFixture = { calls: 0, fail: false, saved: [], opened: "", delay: false };
saveSyncConfig("https://ai.example.test", "fake-test-token", "alice");
const nativeFetch = window.fetch.bind(window);
/** 仅在隔离的演示页面替换测试域名请求，不接触模型或用户存储。 */
window.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith("https://ai.example.test/api/ai/")) return nativeFetch(input, init);
  if (url.endsWith("capabilities"))
    return Response.json({ enabled: true, events: true, knowledge: true });
  window.aiFixture.calls++;
  if (window.aiFixture.delay)
    await new Promise<void>((resolve) => {
      window.aiFixture.release = resolve;
    });
  if (window.aiFixture.fail)
    return Response.json({ error: "模拟网络故障，原文仍保留" }, { status: 503 });
  const request = JSON.parse(String(init?.body));
  if (url.endsWith("events/interpret"))
    return Response.json({
      requestId: request.clientRequestId,
      status: "NEEDS_CLARIFICATION",
      referenceDate: "2026-11-19",
      timezone: "Asia/Shanghai",
      warnings: ["时间信息保存为文字，确认后先保存到本机。"],
      drafts: [
        {
          index: 0,
          date: "2026-11-20",
          title: "和小王开项目会",
          domain: "work",
          startTime: "15:00",
          endDate: null,
          endTime: null,
          durationMinutes: 90,
          unresolvedTimeText: null,
          questions: [],
        },
        {
          index: 1,
          date: "2026-11-20",
          title: "买牛奶",
          domain: "life",
          startTime: null,
          endDate: null,
          endTime: null,
          durationMinutes: null,
          unresolvedTimeText: "晚上",
          questions: ["需要具体几点？也可保留“晚上”作为文字。"],
        },
      ],
    });
  return Response.json({
    requestId: request.clientRequestId,
    answer: "你通过检查配置解决了部署问题。[D1]",
    coverage: "仅相关片段",
    warnings: ["仅依据本次检索的相关片段，非全部记录。"],
    sources: [
      {
        id: "D1",
        date: "2026-11-18",
        title: "项目部署",
        excerpt: "检查配置后解决了项目部署问题。",
        revision: 2,
      },
    ],
  });
};
createRoot(document.getElementById("root")!).render(
  <main className="app">
    <h1>AI 小助手 · 隔离测试</h1>
    <AiPanel
      date="2026-11-19"
      savePlans={async (batch) => {
        window.aiFixture.saved.push(batch);
      }}
      openDiary={(date) => {
        window.aiFixture.opened = date;
      }}
    />
  </main>,
);
