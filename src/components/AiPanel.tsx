import { useEffect, useRef, useState } from "react";
import { getSyncConfig } from "../lib/syncEngine";
import {
  aiCall,
  draftText,
  eventResponse,
  knowledgeResponse,
  sameAiSession,
  type AiCapabilities,
  type AiConfig,
  type EventDraft,
  type EventResponse,
  type KnowledgeResponse,
} from "../lib/ai";
import type { AiPlanBatch } from "../lib/aiPlans";
import "./ai.css";

type Props = {
  date: string;
  /** 原子保存经用户确认的草稿。 */
  savePlans: (batch: AiPlanBatch) => Promise<void>;
  /** 打开引用日期对应的日记原文。 */
  openDiary: (date: string) => void;
};
type EditableDraft = EventDraft & { selected: boolean };

/** 提供显式触发的计划草稿与带原文引用的日记问答，共用于网页和客户端。 */
export default function AiPanel({ date, savePlans, openDiary }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const resultArea = useRef<HTMLElement>(null);
  const eventSession = useRef<AiConfig | null>(null);
  const answerSession = useRef<AiConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"events" | "knowledge">("events");
  const [capabilities, setCapabilities] = useState<AiCapabilities | null>(null);
  const [consent, setConsent] = useState(false);
  const [text, setText] = useState("");
  const [domain, setDomain] = useState<"work" | "life">("life");
  const [result, setResult] = useState<EventResponse | null>(null);
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [question, setQuestion] = useState("");
  const [keywords, setKeywords] = useState("");
  const [from, setFrom] = useState(date.slice(0, 7) + "-01");
  const [to, setTo] = useState(date);
  const [answer, setAnswer] = useState<KnowledgeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (result || answer) resultArea.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [result, answer]);

  /** 关闭或切换页签时废弃未完成响应，保留输入供下次继续编辑。 */
  function cancel() {
    generation.current++;
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
  }
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const controller = new AbortController();
    const cfg = getSyncConfig();
    setCapabilities(null);
    if (cfg?.username) {
      void aiCall(cfg, "capabilities", undefined, controller.signal)
        .then((value) => {
          if (controller.signal.aborted) return;
          const cap = value as AiCapabilities;
          setCapabilities({
            enabled: cap.enabled === true,
            events: cap.events === true,
            knowledge: cap.knowledge === true,
          });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setCapabilities({ enabled: false, events: false, knowledge: false });
        });
    } else setCapabilities({ enabled: false, events: false, knowledge: false });
    return () => {
      controller.abort();
      generation.current++;
      pending.current?.abort();
      dialog.current?.close();
    };
  }, [open]);

  /** 显式发送一次请求；输入、账号或窗口变化后不应用迟到的结果。 */
  async function generate() {
    const cfg = getSyncConfig();
    if (!cfg?.username || !consent || busy) return;
    const controller = new AbortController();
    pending.current = controller;
    const sequence = ++generation.current;
    setBusy(true);
    setMessage("");
    try {
      const clientRequestId = crypto.randomUUID();
      if (tab === "events") {
        eventSession.current = null;
        setResult(null);
        setDrafts([]);
        setSaved(false);
        const data = eventResponse(
          await aiCall(
            cfg,
            "events/interpret",
            {
              clientRequestId,
              text,
              selectedDate: date,
              timezone: "Asia/Shanghai",
              defaultDomain: domain,
            },
            controller.signal,
          ),
        );
        if (generation.current !== sequence || !sameAiSession(cfg)) return;
        if (data.requestId !== clientRequestId) throw new Error("草稿的请求标识不匹配，请重新生成");
        eventSession.current = cfg;
        setResult(data);
        setDrafts(
          data.drafts.map((draft) => ({ ...draft, selected: draft.questions.length === 0 })),
        );
      } else {
        answerSession.current = null;
        setAnswer(null);
        const data = knowledgeResponse(
          await aiCall(
            cfg,
            "knowledge/ask",
            { clientRequestId, question, keywords, from, to },
            controller.signal,
          ),
        );
        if (generation.current !== sequence || !sameAiSession(cfg)) return;
        if (data.requestId !== clientRequestId) throw new Error("回答的请求标识不匹配，请重新提问");
        answerSession.current = cfg;
        setAnswer(data);
      }
    } catch (error) {
      if (generation.current === sequence && !controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : "AI 请求失败，输入仍保留");
    } finally {
      if (generation.current === sequence) {
        setBusy(false);
        pending.current = null;
      }
    }
  }

  /** 整批确认，保存成功后禁用再次提交；保存本机后沿用原有同步流程。 */
  async function confirm() {
    const cfg = eventSession.current;
    if (!cfg?.username || !result || busy || saved) return;
    setBusy(true);
    setMessage("");
    try {
      const items = drafts
        .filter((draft) => draft.selected)
        .map((draft) => {
          if (!draft.title.trim() || draft.title.length > 200)
            throw new Error("计划内容请填写1～200字");
          return {
            index: draft.index,
            date: draft.date,
            text: draftText(draft),
            domain: draft.domain,
          };
        });
      if (!items.length) throw new Error("请至少选择一条计划");
      if (!sameAiSession(cfg)) throw new Error("登录账号已变化，请重新打开 AI 助手");
      await savePlans({ account: cfg.username, requestId: result.requestId, items });
      if (sameAiSession(cfg)) {
        setSaved(true);
        setMessage("已保存到本机计划，可点击「立即同步」同步到其他设备。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  /** 更新单项预览，不改变服务器分配的稳定草稿编号。 */
  function edit(index: number, patch: Partial<EditableDraft>) {
    setDrafts((current) =>
      current.map((draft) => (draft.index === index ? { ...draft, ...patch } : draft)),
    );
  }
  /** 原文跳转也绑定生成答案时的登录会话，不能沿用另一账号的引用。 */
  function openSource(date: string) {
    if (!answerSession.current || !sameAiSession(answerSession.current)) {
      setMessage("登录账号已变化，请重新打开 AI 助手");
      return;
    }
    cancel();
    setOpen(false);
    openDiary(date);
  }
  const enabled = capabilities?.enabled && capabilities[tab];
  return (
    <>
      <button
        className="timeline-entry ai-entry"
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
      >
        <span>✦ AI 小助手</span>
        <small>说出计划，或从日记里找回答案 →</small>
      </button>
      <dialog
        ref={dialog}
        className="diary-dialog ai-dialog"
        aria-labelledby="ai-title"
        onCancel={() => {
          cancel();
          setOpen(false);
        }}
        onClose={() => {
          cancel();
          setOpen(false);
        }}
      >
        <header className="timeline-heading">
          <div>
            <small>MY LITTLE DAYS · 灵感小伙伴</small>
            <h2 id="ai-title">✦ 给想法一点帮忙</h2>
          </div>
          <button
            aria-label="关闭 AI 助手"
            onClick={() => {
              cancel();
              setOpen(false);
            }}
          >
            ×
          </button>
        </header>
        <nav className="diary-tabs" aria-label="AI 功能">
          <button
            aria-pressed={tab === "events"}
            onClick={() => {
              cancel();
              setTab("events");
              setMessage("");
            }}
          >
            一句话写计划
          </button>
          <button
            aria-pressed={tab === "knowledge"}
            onClick={() => {
              cancel();
              setTab("knowledge");
              setMessage("");
            }}
          >
            问问日记
          </button>
        </nav>
        {!enabled && (
          <p className="ai-hint">
            {capabilities === null
              ? "正在查看服务状态…"
              : "AI 尚未启用或当前未登录，原有计划与日记功能可照常使用。"}
          </p>
        )}
        <label className="ai-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={busy}
          />
          <span>我知道：点击生成后，输入内容及问答所需的相关日记片段会发送给 DeepSeek。</span>
        </label>
        {tab === "events" ? (
          <>
            <p className="ai-hint">
              当前选中 {date}；“明天”等相对日期按北京时间的今天计算。生成后请核对，不会自动保存。
            </p>
            <label>
              想安排什么？
              <textarea
                value={text}
                maxLength={1000}
                rows={4}
                disabled={busy}
                placeholder="例如：明天下午三点开项目会，预计一个小时，周六去公园散步"
                onChange={(e) => {
                  setText(e.target.value);
                  setResult(null);
                  setDrafts([]);
                }}
              />
            </label>
            <label className="ai-default">
              默认分类
              <select
                value={domain}
                disabled={busy}
                onChange={(e) => {
                  setDomain(e.target.value as "work" | "life");
                  setResult(null);
                  setDrafts([]);
                }}
              >
                <option value="life">生活</option>
                <option value="work">工作</option>
              </select>
            </label>
            <button
              className="diary-primary"
              disabled={!enabled || !consent || busy || !text.trim()}
              onClick={() => void generate()}
            >
              {busy ? "正在处理…" : "生成计划草稿"}
            </button>
            {result && (
              <section ref={resultArea} className="ai-result" aria-label="计划草稿">
                <p>日期参考：{result.referenceDate}（北京时间）</p>
                {result.warnings.map((warning, i) => (
                  <p className="ai-hint" key={i}>
                    {warning}
                  </p>
                ))}
                {!drafts.length && <p>没有识别到可安排的计划，请补充日期和事项。</p>}
                <fieldset disabled={busy || saved} className="ai-drafts">
                  {drafts.map((draft) => (
                    <article className="ai-card" key={draft.index}>
                      <label className="ai-consent">
                        <input
                          type="checkbox"
                          checked={draft.selected}
                          onChange={(e) => edit(draft.index, { selected: e.target.checked })}
                        />
                        <strong>加入计划 {draft.index + 1}</strong>
                      </label>
                      <div className="ai-fields">
                        <label>
                          日期
                          <input
                            type="date"
                            value={draft.date}
                            onChange={(e) => edit(draft.index, { date: e.target.value })}
                          />
                        </label>
                        <label>
                          分类
                          <select
                            value={draft.domain}
                            onChange={(e) =>
                              edit(draft.index, { domain: e.target.value as "work" | "life" })
                            }
                          >
                            <option value="life">生活</option>
                            <option value="work">工作</option>
                          </select>
                        </label>
                      </div>
                      <label>
                        事项
                        <input
                          value={draft.title}
                          maxLength={200}
                          onChange={(e) => edit(draft.index, { title: e.target.value })}
                        />
                      </label>
                      <div className="ai-fields">
                        <label>
                          开始时间（可空）
                          <input
                            type="time"
                            value={draft.startTime ?? ""}
                            onChange={(e) =>
                              edit(draft.index, { startTime: e.target.value || null })
                            }
                          />
                        </label>
                        <label>
                          耗时（分钟，可空）
                          <input
                            type="number"
                            min={1}
                            max={10080}
                            step={1}
                            value={draft.durationMinutes ?? ""}
                            onChange={(e) =>
                              edit(draft.index, {
                                durationMinutes:
                                  e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          结束日期（可空）
                          <input
                            type="date"
                            value={draft.endDate ?? ""}
                            onChange={(e) => edit(draft.index, { endDate: e.target.value || null })}
                          />
                        </label>
                        <label>
                          结束时间（可空）
                          <input
                            type="time"
                            value={draft.endTime ?? ""}
                            onChange={(e) => edit(draft.index, { endTime: e.target.value || null })}
                          />
                        </label>
                      </div>
                      <label>
                        未明确的时间描述（可空）
                        <input
                          value={draft.unresolvedTimeText ?? ""}
                          maxLength={60}
                          onChange={(e) =>
                            edit(draft.index, { unresolvedTimeText: e.target.value || null })
                          }
                        />
                      </label>
                      {draft.questions.length > 0 && (
                        <div className="ai-hint">
                          <strong>需要你确认，默认不选：</strong>
                          {draft.questions.map((q, i) => (
                            <p key={i}>{q}</p>
                          ))}
                          <small>修正上方信息后，再勾选加入计划。</small>
                        </div>
                      )}
                    </article>
                  ))}
                </fieldset>
                {drafts.length > 0 && (
                  <button
                    className="diary-primary"
                    onClick={() => void confirm()}
                    disabled={busy || saved || !drafts.some((d) => d.selected)}
                  >
                    {saved ? "✓ 已保存" : "确认所选并保存计划"}
                  </button>
                )}
              </section>
            )}
          </>
        ) : (
          <>
            <p className="ai-hint">
              先按关键词查找你的日记，再根据相关片段作答。结果只覆盖检索到的片段，不能用于完整统计。
            </p>
            <label>
              想问什么？
              <textarea
                rows={3}
                value={question}
                maxLength={1000}
                disabled={busy}
                placeholder="例如：我之前是怎么解决项目部署问题的？"
                onChange={(e) => {
                  setQuestion(e.target.value);
                  setAnswer(null);
                }}
              />
            </label>
            <label>
              检索关键词
              <input
                value={keywords}
                maxLength={100}
                disabled={busy}
                placeholder="例如：项目 部署"
                onChange={(e) => {
                  setKeywords(e.target.value);
                  setAnswer(null);
                }}
              />
            </label>
            <div className="ai-fields">
              <label>
                开始日期
                <input
                  type="date"
                  value={from}
                  disabled={busy}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setAnswer(null);
                  }}
                />
              </label>
              <label>
                结束日期
                <input
                  type="date"
                  value={to}
                  disabled={busy}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setAnswer(null);
                  }}
                />
              </label>
            </div>
            <button
              className="diary-primary"
              disabled={
                !enabled ||
                !consent ||
                busy ||
                !question.trim() ||
                !keywords.trim() ||
                !from ||
                !to ||
                from > to
              }
              onClick={() => void generate()}
            >
              {busy ? "正在查找与整理…" : "查找并回答"}
            </button>
            {answer && (
              <section ref={resultArea} className="ai-result">
                <h3>日记里的线索</h3>
                <p className="ai-answer">{answer.answer}</p>
                {answer.warnings.map((w, i) => (
                  <p className="ai-hint" key={i}>
                    {w}
                  </p>
                ))}
                {answer.sources.map((source) => (
                  <article className="ai-card" key={source.id}>
                    <h4>
                      {source.id} · {source.date} · {source.title || "未命名日记"}
                    </h4>
                    <p className="ai-answer">{source.excerpt}</p>
                    <button onClick={() => openSource(source.date)}>打开日记原文 ↗</button>
                  </article>
                ))}
              </section>
            )}
          </>
        )}
        {message && (
          <p className="ai-hint" role="status">
            {message}
          </p>
        )}
        {busy && <button onClick={cancel}>停止等待</button>}
      </dialog>
    </>
  );
}
