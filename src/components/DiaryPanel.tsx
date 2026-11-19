import { browserStorage as localStorage } from "../lib/browserStorage";
import { useEffect, useRef, useState } from "react";
import { getSyncConfig } from "../lib/syncEngine";
import { validDiaryDate, type DiaryEntry, type DiarySearch } from "../lib/diary";
import "./diary.css";
type Config = NonNullable<ReturnType<typeof getSyncConfig>>;
class DiaryError extends Error {
  /** 记录日记接口返回的 HTTP 状态，用于区分版本冲突与其他错误。 */
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
/** 携带当前账号令牌调用日记接口，并统一处理 JSON 响应和失败状态。 */
async function call<T>(
  cfg: Config,
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(cfg.server + "/api/diaries" + path, {
    method,
    headers: { authorization: "Bearer " + cfg.token, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal ?? AbortSignal.timeout(10000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new DiaryError(data.error ?? "日记请求失败，请稍后重试", r.status);
  return data;
}
type Draft = { title: string; content: string; revision: number };
/** 根据选中日期和登录状态组织日记编辑与检索界面。 */
export default function DiaryPanel({
  date,
  requestedDate,
}: {
  date: string;
  requestedDate?: { date: string; nonce: number };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState<"write" | "search">("write"),
    [day, setDay] = useState(date);
  const cfg = getSyncConfig();
  useEffect(() => {
    if (!requestedDate || !validDiaryDate(requestedDate.date)) return;
    setDay(requestedDate.date);
    setTab("write");
    setOpen(true);
  }, [requestedDate]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <>
      <button
        className="timeline-entry diary-entry"
        onClick={() => {
          setDay(date);
          setTab("write");
          setOpen(true);
        }}
      >
        <span>✎ 写日记 / 查日记</span>
        <small>把今天留在纸上，随时找回过去的片段 →</small>
      </button>
      <dialog
        className="diary-dialog"
        ref={dialog}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        aria-labelledby="diary-title"
      >
        <header className="timeline-heading">
          <div>
            <small>MY LITTLE DAYS · 日记本</small>
            <h2 id="diary-title">留住每一天</h2>
          </div>
          <button onClick={() => setOpen(false)} aria-label="关闭日记">
            ×
          </button>
        </header>
        <nav className="diary-tabs" aria-label="日记功能">
          <button aria-pressed={tab === "write"} onClick={() => setTab("write")}>
            ✎ 写日记
          </button>
          <button aria-pressed={tab === "search"} onClick={() => setTab("search")}>
            ⌕ 查日记
          </button>
        </nav>
        {!cfg && (
          <p className="diary-message">
            当前为本机模式，可以写草稿；登录账号后可保存到云端和搜索。
          </p>
        )}
        {open &&
          (tab === "write" ? (
            <>
              <label className="diary-date">
                日记日期
                <input
                  type="date"
                  value={day}
                  onChange={(e) => {
                    if (validDiaryDate(e.target.value)) setDay(e.target.value);
                  }}
                />
              </label>
              <DiaryEditor
                key={JSON.stringify([cfg?.server, cfg?.username, day])}
                date={day}
                cfg={cfg}
              />
            </>
          ) : (
            <DiaryFinder
              cfg={cfg}
              openDate={(value) => {
                setDay(value);
                setTab("write");
              }}
            />
          ))}
      </dialog>
    </>
  );
}
/** 管理某一天的日记正文、草稿和云端版本冲突。 */
function DiaryEditor({ date, cfg }: { date: string; cfg: Config | null }) {
  const key =
    "calendar.diary.draft:" +
    JSON.stringify([cfg?.server ?? "local", cfg?.username ?? "local", date]);
  const [title, setTitle] = useState(""),
    [content, setContent] = useState(""),
    [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(Boolean(cfg)),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [conflict, setConflict] = useState(false);
  const alive = useRef(true),
    cloud = useRef<{ entry: DiaryEntry | null; revision: number } | null>(null);
  useEffect(() => {
    alive.current = true;
    let active = true;
    let draft: Draft | null = null;
    try {
      const d = JSON.parse(localStorage.getItem(key) ?? "null");
      if (
        d &&
        typeof d.title === "string" &&
        typeof d.content === "string" &&
        Number.isSafeInteger(d.revision)
      )
        draft = d;
    } catch {
      /* Ignore corrupted drafts. */
    }
    if (draft) {
      setTitle(draft.title);
      setContent(draft.content);
      setRevision(draft.revision);
      setMessage("已恢复本地草稿，尚未保存到云端。");
    }
    if (!cfg)
      return () => {
        active = false;
        alive.current = false;
      };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    void call<{ entry: DiaryEntry | null; revision: number }>(
      cfg,
      "/entries/" + date,
      "GET",
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (!active) return;
        cloud.current = data;
        if (!draft) {
          setTitle(data.entry?.title ?? "");
          setContent(data.entry?.content ?? "");
          setRevision(data.revision);
          setMessage(data.entry ? "已载入云端日记。" : "今天还没有日记，写下第一句话吧。");
        } else if (draft.revision !== data.revision) {
          setConflict(true);
          setMessage("云端另有更新，本地草稿已保留。请先导出草稿，再载入云端版本进行整理。");
        }
      })
      .catch(() => {
        if (active) setMessage("暂时无法读取云端，可以继续写本地草稿；恢复网络后重试。");
      })
      .finally(() => {
        clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      alive.current = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [key]);
  /** 更新日记输入内容，同时保存账号隔离的本地草稿。 */
  function edit(nextTitle: string, nextContent: string) {
    setTitle(nextTitle);
    setContent(nextContent);
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ title: nextTitle, content: nextContent, revision }),
      );
      setMessage(
        conflict
          ? "草稿已保存在本机，云端版本仍有冲突。"
          : "草稿已保存在本机，点击保存后上传云端。",
      );
    } catch {
      setMessage("本地草稿存储失败，请导出正文，避免丢失。");
    }
  }
  /** 将当前草稿导出为文本文件，便于另行保存。 */
  function exportDraft() {
    const url = URL.createObjectURL(
      new Blob([title + "\n\n" + content], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "日记草稿-" + date + ".txt";
    a.click();
    URL.revokeObjectURL(url);
  }
  /** 重新读取云端日记，用于查看最新版本或处理保存冲突。 */
  async function reload() {
    if (!cfg || !window.confirm("载入云端会替换当前编辑内容。请先导出需要保留的草稿。继续？"))
      return;
    setBusy(true);
    try {
      const data = await call<{ entry: DiaryEntry | null; revision: number }>(
        cfg,
        "/entries/" + date,
      );
      if (!alive.current) return;
      cloud.current = data;
      setTitle(data.entry?.title ?? "");
      setContent(data.entry?.content ?? "");
      setRevision(data.revision);
      setConflict(false);
      localStorage.removeItem(key);
      setMessage("已载入最新云端版本。");
    } catch (e) {
      if (alive.current) setMessage((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  /** 按当前版本号保存或删除日记；冲突时保留草稿供用户处理。 */
  async function save(remove = false) {
    if (!cfg) return;
    if (remove && !window.confirm("删除这一天的云端日记和本地草稿？")) return;
    setBusy(true);
    try {
      if (remove) {
        const data = await call<{ revision: number }>(cfg, "/entries/" + date, "DELETE", {
          expectedRevision: revision,
        });
        if (!alive.current) return;
        setTitle("");
        setContent("");
        setRevision(data.revision);
        setMessage("日记已删除。");
      } else {
        const data = await call<{ entry: DiaryEntry }>(cfg, "/entries/" + date, "PUT", {
          title,
          content,
          expectedRevision: revision,
        });
        if (!alive.current) return;
        setTitle(data.entry.title);
        setRevision(data.entry.revision);
        setMessage("已保存到云端，搜索结果将在稍后更新。");
      }
      setConflict(false);
      localStorage.removeItem(key);
    } catch (e) {
      if (alive.current) {
        setMessage((e as Error).message);
        if (e instanceof DiaryError && e.status === 409) setConflict(true);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="diary-editor" aria-busy={busy || loading}>
      <label>
        给今天起个标题
        <input
          value={title}
          maxLength={100}
          readOnly={loading || busy}
          onChange={(e) => edit(e.target.value, content)}
          placeholder="今天，有什么想记住的？"
        />
      </label>
      <label>
        日记正文
        <textarea
          value={content}
          maxLength={20000}
          readOnly={loading || busy}
          onChange={(e) => edit(title, e.target.value)}
          placeholder="从一件小事开始写，也很好……"
        />
      </label>
      <div className="diary-status">
        <p role="status">{loading ? "正在读取云端…" : message}</p>
        <small>{content.length} / 20000 字</small>
      </div>
      <div className="diary-controls">
        <button
          className="diary-primary"
          disabled={!cfg || loading || busy || conflict || !content.trim()}
          onClick={() => void save()}
        >
          {busy ? "处理中…" : "保存日记"}
        </button>
        <button disabled={loading || busy || (!content && !title)} onClick={exportDraft}>
          导出草稿
        </button>
        <button disabled={!cfg || loading || busy} onClick={() => void reload()}>
          载入云端版本
        </button>
        <button
          disabled={!cfg || loading || busy || conflict || revision === 0}
          onClick={() => void save(true)}
        >
          删除日记
        </button>
      </div>
      <p className="diary-hint">
        日记仅自己可见。正文保存在云端，编辑草稿保存在当前设备；切换日期后可回来继续写。
      </p>
    </section>
  );
}
/** 按关键词及日期范围检索当前账号的日记。 */
function DiaryFinder({
  cfg,
  openDate,
}: {
  cfg: Config | null;
  /** 载入搜索结果对应的日记，并切换到该日期。 */
  openDate: (date: string) => void;
}) {
  const [q, setQ] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<{
      items: DiaryEntry[];
      total: number;
      page: number;
      indexing: boolean;
    } | null>(null),
    [submitted, setSubmitted] = useState<DiarySearch | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      const previous = request.current;
      request.current = null;
      previous?.abort();
    },
    [],
  );
  /** 提交日记搜索请求，并按页更新结果和索引状态。 */
  async function search(input: DiarySearch) {
    if (!cfg) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setBusy(true);
    setError("");
    setSubmitted(input);
    setResult(null);
    try {
      const params = new URLSearchParams({
        q: input.q,
        page: String(input.page),
        ...(input.from ? { from: input.from } : {}),
        ...(input.to ? { to: input.to } : {}),
      });
      const data = await call<NonNullable<typeof result>>(
        cfg,
        "/search?" + params,
        "GET",
        undefined,
        controller.signal,
      );
      if (request.current === controller && !controller.signal.aborted) setResult(data);
    } catch (e) {
      if (request.current === controller)
        setError(controller.signal.aborted ? "查询超时，请稍后重试" : (e as Error).message);
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setBusy(false);
    }
  }
  return (
    <section className="diary-finder">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search({ q, from: from || undefined, to: to || undefined, page: 1 });
        }}
      >
        <label className="diary-query">
          想找哪段回忆？
          <input
            value={q}
            required
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
            placeholder="例如：旅行、读书、上海"
          />
        </label>
        <label>
          开始日期
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          结束日期
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="diary-primary" disabled={!cfg || busy}>
          {busy ? "查询中…" : "搜索日记"}
        </button>
      </form>
      {error && (
        <p className="diary-message" role="alert">
          {error}
        </p>
      )}
      {!result && !error && (
        <div className="diary-search-empty">
          ⌕<h3>过去写下的话，都可以再找到</h3>
          <p>输入关键词，搜索自己的日记标题和正文。</p>
        </div>
      )}
      {result && (
        <>
          <p className="diary-hint">
            共 {result.total} 条匹配 · 第 {result.page} 页
            {result.indexing ? " · 部分记录正在更新，请稍后重试" : ""}
          </p>
          <div className="diary-results">
            {result.items.map((item) => (
              <button key={item.date} className="diary-result" onClick={() => openDate(item.date)}>
                <time>{item.date}</time>
                <h3>{item.title || "未命名日记"}</h3>
                <p>
                  {item.content.slice(0, 220)}
                  {item.content.length > 220 ? "…" : ""}
                </p>
                <small>打开这篇日记 →</small>
              </button>
            ))}
          </div>
          {!result.items.length && (
            <p className="diary-message">
              没有找到日记。刚保存的内容可能还在更新搜索结果，请稍后重试。
            </p>
          )}
          <div className="diary-controls">
            <button
              disabled={busy || result.page <= 1}
              onClick={() => void search({ ...submitted!, page: result.page - 1 })}
            >
              上一页
            </button>
            <button
              disabled={busy || result.page * 20 >= result.total}
              onClick={() => void search({ ...submitted!, page: result.page + 1 })}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </section>
  );
}
