import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import QuickAdd from "./QuickAdd";
import "./styles.css";
import "./storybook.css";

const params = new URLSearchParams(window.location.search);
const isQuickWindow = params.get("window") === "quick";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {import.meta.env?.VITE_CLOUD_TRIAL === "true" && (
      <aside
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          padding: "8px 12px",
          textAlign: "center",
          background: "#fff2c7",
          color: "#503b16",
          fontSize: 14,
        }}
      >
        {import.meta.env?.VITE_SHARED_DATA === "true"
          ? "Spring Cloud · 与正式版共用云端数据 · "
          : "Spring Cloud 试运行 · 使用独立数据副本，试写内容不会同步到正式版 · "}
        <a href="https://cal.imlaomi.cn/">返回正式版</a>
      </aside>
    )}
    {isQuickWindow ? <QuickAdd /> : <App />}
    {!window.desktopAPI && !isQuickWindow && (
      <footer className="filing-footer">
        <a href="https://imlaomi.cn/">日历表官网</a>
        <span> · </span>
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
          沪ICP备2026050808号-1
        </a>
      </footer>
    )}
  </StrictMode>,
);
