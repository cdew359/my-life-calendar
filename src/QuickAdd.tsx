import { useEffect, useRef, useState } from "react";
import { todayKey } from "./lib/dates";
import { useData } from "./lib/storage";

/** 桌面端快速添加小窗：一行输入，回车存到今天，Esc 关闭 */
export default function QuickAdd() {
  const { addPlan } = useData();
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const today = todayKey();
  const [, m, d] = today.split("-").map(Number);

  // 每次窗口重新显示时聚焦输入框并全选，方便直接覆盖输入
  useEffect(() => {
    /** 把输入焦点放到快速添加窗口的文本框。 */
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    focus();
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("focus", focus);
      window.clearTimeout(hideTimer.current);
    };
  }, []);

  /** 校验快速输入，保存计划后清空输入并收起窗口。 */
  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      window.desktopAPI?.quickAdd.hide();
      return;
    }
    addPlan(today, trimmed, "life");
    setDraft("");
    setSaved(true);
    hideTimer.current = window.setTimeout(() => {
      setSaved(false);
      window.desktopAPI?.quickAdd.hide();
    }, 700);
  };

  return (
    <div className="quickadd">
      <p className="quickadd-label">
        添加到今天 · {m}月{d}日
      </p>
      <input
        ref={inputRef}
        className="quickadd-input"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") window.desktopAPI?.quickAdd.hide();
        }}
        placeholder="想做什么？"
        maxLength={60}
      />
      <p className={saved ? "quickadd-hint saved" : "quickadd-hint"}>
        {saved ? "✓ 已添加" : "Enter 保存 · Esc 关闭"}
      </p>
    </div>
  );
}
