// A local, in-memory fixture: no login, network synchronization or user storage.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import TimelinePanel from "../../src/components/TimelinePanel";
import { changeTimeline } from "../../src/lib/timelines";
import { emptyData } from "../../src/lib/validate";
import type { AppData } from "../../src/lib/types";
import "../../src/styles.css";
import "../../src/storybook.css";

const now = Date.now();
const sample: AppData = {
  ...emptyData(),
  plans: ["阅读", "整理笔记"].map((text, i) => ({
    id: `sample-${i}`,
    text,
    date: "2026-10-07",
    domain: "life",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    done: false,
    doneAt: null,
  })),
  timelines: [
    {
      id: "sample-line",
      name: "完成项目提交",
      date: "2026-10-07",
      startTime: "18:00",
      endTime: "18:00",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      items: [
        { id: "i0", planId: "sample-0", durationMinutes: 90 },
        { id: "i1", planId: "sample-1", durationMinutes: 20 },
      ],
    },
  ],
};
/** 渲染含演示数据的时间预排界面，供本地样式检查使用。 */
function Preview() {
  const [data, setData] = useState(sample);
  const [date, setDate] = useState("2026-10-07");
  return (
    <main className="app">
      <h1>时间预排 · 样例预览</h1>
      <p>这里使用内存中的样例数据，关闭窗口即重置。</p>
      <label>
        查看日期{" "}
        <input
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value);
          }}
        />
      </label>
      <button
        onClick={() => {
          document.documentElement.dataset.theme =
            document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        }}
      >
        切换深浅色
      </button>
      <TimelinePanel
        data={data}
        date={date}
        save={async (input) => {
          setData(changeTimeline(data, input));
        }}
        toggle={(id) =>
          setData((current) => ({
            ...current,
            plans: current.plans.map((p) =>
              p.id === id
                ? { ...p, done: !p.done, doneAt: p.done ? null : Date.now(), updatedAt: Date.now() }
                : p,
            ),
          }))
        }
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
