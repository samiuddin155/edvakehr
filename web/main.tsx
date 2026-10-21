import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import type { AgentResult, ClinicConfig, IncomingMessage, RunEvaluation } from "../server/types.js";

type Processed = AgentResult & { loading?: boolean };
type QueueItem = { message_id: string; queue: string; reason: string; status: string; created_at?: string };
const percent = (value: number) => `${Math.round(value * 100)}%`;

function App() {
  const [clinic, setClinic] = useState<ClinicConfig | null>(null);
  const [messages, setMessages] = useState<IncomingMessage[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [results, setResults] = useState<Record<string, Processed>>({});
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [evaluation, setEvaluation] = useState<RunEvaluation | null>(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<{ dataSource: string; modelConfigured: boolean; supabaseConfigured: boolean; mcp?: { connected: boolean; transport: string; tools: string[] } } | null>(null);

  useEffect(() => { void (async () => {
    try {
      const [inbox, status, savedRuns, savedQueues] = await Promise.all([fetch("/api/inbox").then((r) => r.json()), fetch("/api/health").then((r) => r.json()), fetch("/api/runs").then((r) => r.json()), fetch("/api/queues").then((r) => r.json())]);
      if (!inbox.messages) throw new Error(inbox.error || "The API is not reachable.");
      setClinic(inbox.clinic); setMessages(inbox.messages); setSelectedId(inbox.messages[0]?.id ?? ""); setHealth(status);
      setResults(Object.fromEntries((savedRuns.runs ?? []).map((run: AgentResult) => [run.id, run])));
      setQueueItems(savedQueues.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to connect to the API"); }
  })(); }, []);

  const selected = messages.find((message) => message.id === selectedId);
  const current = results[selectedId];
  const visible = useMemo(() => messages.filter((message) => {
    const result = results[message.id];
    if (filter === "unprocessed") return !result;
    if (filter === "emergency") return result?.urgency === "emergency" || (!result && /chest pain|can't finish sentences|hit .*head|dark stools|blood sugar.*45/i.test(message.body));
    if (filter === "needs-review") return result?.routed_to?.length || !result;
    if (filter.startsWith("queue:")) return result?.routed_to?.includes(filter.slice(6) as AgentResult["routed_to"][number]) || queueItems.some((item) => item.message_id === message.id && item.queue === filter.slice(6) && item.status === "open");
    return true;
  }), [messages, results, filter, queueItems]);

  async function process(id = selectedId) {
    setLoading(true); setError(""); setResults((old) => ({ ...old, [id]: { ...(old[id] ?? {} as AgentResult), loading: true } }));
    try { const response = await fetch(`/api/process/${encodeURIComponent(id)}`, { method: "POST" }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setResults((old) => ({ ...old, [id]: result })); setQueueItems((old) => [...old.filter((item) => item.message_id !== id), ...(result.queue_reasons ?? []).map((item: { queue: string; reason: string }) => ({ message_id: id, ...item, status: "open" }))]); }
    catch (e) { setError(e instanceof Error ? e.message : "Processing failed"); setResults((old) => { const next = { ...old }; delete next[id]; return next; }); }
    finally { setLoading(false); }
  }
  async function processAll() {
    setLoading(true); setError("");
    try { const response = await fetch("/api/evaluate"); const data = await response.json(); if (!response.ok) throw new Error(data.error); setEvaluation(data.evaluation); setResults((old) => ({ ...old, ...Object.fromEntries(data.results.map((r: AgentResult) => [r.id, r])) })); setQueueItems((old) => [...old.filter((item) => !data.results.some((r: AgentResult) => r.id === item.message_id)), ...data.results.flatMap((r: AgentResult) => (r.queue_reasons ?? []).map((item) => ({ message_id: r.id, ...item, status: "open" })))]); }
    catch (e) { setError(e instanceof Error ? e.message : "Batch processing failed"); }
    finally { setLoading(false); }
  }
  const initial = selected?.from_name?.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
  return <div className="app-shell">
    <aside className="rail"><div className="brand-mark">m<span>+</span></div><div className="rail-icons"><button className="rail-icon selected" title="Inbox">▤</button><button className="rail-icon" title="Patients">♙</button><button className="rail-icon" title="Calendar">▦</button></div><div className="avatar-small">MF</div></aside>
    <aside className="sidebar">
      <div className="clinic-heading"><div className="clinic-symbol">✳</div><div><strong>Maplewood</strong><small>Family Clinic</small></div><button className="chevron">⌄</button></div>
      <div className="side-label">WORKSPACE</div><button className="nav-item active"><span>▤</span> Inbox <b>{messages.length}</b></button><button className="nav-item"><span>▦</span> Appointments</button><button className="nav-item"><span>♙</span> Patients</button>
      <div className="side-label queue-title">QUEUES <button>＋</button></div><button className="queue-item" onClick={() => setFilter("queue:clinician_urgent")}><i className="dot red"/> Urgent clinical <b>{queueItems.filter((item) => item.queue === "clinician_urgent" && item.status === "open").length || Object.values(results).filter((r) => r.routed_to?.includes("clinician_urgent")).length}</b></button><button className="queue-item" onClick={() => setFilter("queue:provider_refills")}><i className="dot purple"/> Provider refills <b>{queueItems.filter((item) => item.queue === "provider_refills" && item.status === "open").length}</b></button><button className="queue-item" onClick={() => setFilter("queue:front_desk")}><i className="dot blue"/> Front desk <b>{queueItems.filter((item) => item.queue === "front_desk" && item.status === "open").length}</b></button><button className="queue-item" onClick={() => setFilter("queue:billing")}><i className="dot amber"/> Billing <b>{queueItems.filter((item) => item.queue === "billing" && item.status === "open").length}</b></button>
      <div className="sidebar-footer"><span className="green-dot"/> MCP {health?.mcp?.connected ? "stdio connected" : "connecting"}<small>{health?.dataSource === "supabase" ? "Supabase data · runs saved" : "Local fixtures · runs not saved"}<br/>{health?.modelConfigured ? "OpenRouter connected" : "Local rules mode"}</small></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>Inbox</strong></div><div className="top-actions"><div className="date-label">{clinic?.today ?? "—"}</div><button className="help-button">?</button><div className="avatar-small top-avatar">MF</div></div></header>
      <section className="page-heading"><div><div className="eyebrow">PATIENT COMMUNICATIONS</div><h1>Inbox</h1><p>Review incoming messages and AI-prepared next steps.</p></div><button className="button primary" onClick={() => void processAll()} disabled={loading}>{loading ? <span className="spinner"/> : <span>✳</span>} Run all & evaluate</button></section>
      {error && <div className="error-banner">{error}</div>}
      {evaluation && <section className="eval-strip"><div className="eval-title"><span>✳</span><div><strong>Evaluation complete</strong><small>{evaluation.total} sample messages · model results below</small></div></div><Metric label="Urgency accuracy" value={percent(evaluation.urgencyAccuracy)}/><Metric label="Emergency recall" value={percent(evaluation.emergencyRecall)} critical={evaluation.emergencyRecall < 1}/><Metric label="Action F1" value={percent(evaluation.actionMicroF1)}/><Metric label="Must-not violations" value={`${evaluation.mustNotViolations.length}`} critical={evaluation.mustNotViolations.length > 0}/></section>}
      <section className="workspace">
        <div className="message-list-panel"><div className="list-head"><div><strong>Messages</strong><span className="count-pill">{visible.length}</span></div><button className="icon-button" title="Search">⌕</button></div><div className="filter-row"><button className={filter === "all" ? "filter active-filter" : "filter"} onClick={() => setFilter("all")}>All</button><button className={filter === "needs-review" ? "filter active-filter" : "filter"} onClick={() => setFilter("needs-review")}>Needs review</button><button className={filter === "emergency" ? "filter active-filter" : "filter"} onClick={() => setFilter("emergency")}>Urgent</button><button className="filter-more" onClick={() => setFilter(filter === "unprocessed" ? "all" : "unprocessed")}>•••</button></div><div className="messages-scroll">{visible.map((message) => {
          const result = results[message.id]; const active = message.id === selectedId;
          return <button className={`message-row ${active ? "selected-message" : ""}`} key={message.id} onClick={() => setSelectedId(message.id)}><div className={`person-avatar ${result?.urgency === "emergency" ? "avatar-emergency" : ""}`}>{message.from_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</div><div className="message-summary"><div className="row-top"><strong>{message.from_name}</strong><time>{new Date(message.received_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div><div className="subject-line">{subject(message.body)}</div><div className="preview-line">{message.body}</div><div className="row-bottom"><span className="channel-tag">{message.channel}</span>{result && <span className={`urgency-tag ${result.urgency}`}>{result.urgency}</span>}</div></div></button>;
        })}</div><div className="list-footer"><span><i className="green-dot"/> Synced just now</span><button title="Refresh" onClick={() => window.location.reload()}>↻</button></div></div>
        <div className="detail-panel">{selected ? <><div className="detail-header"><div><div className="eyebrow">INCOMING MESSAGE <span className="id-tag">{selected.id}</span></div><h2>{subject(selected.body)}</h2></div><button className="icon-button">•••</button></div><div className="sender-card"><div className="person-avatar large-avatar">{initial}</div><div><strong>{selected.from_name}</strong><div className="contact-line">{selected.from_contact} <span>·</span> {selected.channel}</div></div><button className="secondary-button">View patient ↗</button></div><div className="message-bubble"><div className="bubble-top"><span>MESSAGE</span><time>{new Date(selected.received_at).toLocaleString()}</time></div><p>{selected.body}</p></div>
          <div className="assistant-heading"><div className="assistant-icon">✳</div><div><strong>Assistant review</strong><small>{current && !current.loading ? (current.mode === "openrouter" ? current.model : "Local rules · no API key") : "Ready to analyze"}</small></div>{current?.urgency && <span className={`urgency-tag ${current.urgency}`}>{current.urgency} priority</span>}</div>
          {!current && <div className="analyze-card"><div className="sparkle">✳</div><strong>Prepare a safe response</strong><p>The assistant will classify intent, verify identity, check clinic rules, and draft next steps for staff review.</p><button className="button primary" onClick={() => void process()} disabled={loading}>✳ &nbsp;Analyze message</button><small>Nothing is sent to the patient automatically.</small></div>}
          {current?.loading && <div className="loading-card"><span className="spinner"/> Reviewing message and clinic policy…</div>}
          {current && !current.loading && <><div className="result-grid"><div className="result-card"><span>IDENTITY</span><strong>{current.verification === "verified" ? "Verified" : "Unverified"}</strong><small>{current.patient_id ? `Patient ${current.patient_id}` : current.matched_patient_id ? `Possible match ${current.matched_patient_id} · verification needed` : "No matching patient record"}</small></div><div className="result-card"><span>INTENT</span><strong>{current.intents.join(" + ")}</strong><small>Urgency: {current.urgency}</small></div></div><div className="reply-card"><div className="card-heading"><strong>Suggested reply</strong><span className="draft-label">DRAFT · REVIEW REQUIRED</span></div><p>{current.reply_draft}</p><div className="reply-actions"><button className="secondary-button" onClick={() => navigator.clipboard?.writeText(current.reply_draft)}>Copy draft</button><span>Staff approval required</span></div></div><div className="route-card"><div className="card-heading"><strong>Recommended actions</strong><span className="count-pill">{current.actions.length}</span></div><div className="action-chips">{current.actions.map((action) => <span className="action-chip" key={action}>{humanize(action)}</span>)}</div>{current.routed_to.length > 0 && <div className="routes-list">{current.routed_to.map((queue) => <div className="route-row" key={queue}><i className={`dot ${queue === "clinician_urgent" ? "red" : "blue"}`}/><span>{humanize(queue)}</span><small>Queued for staff</small></div>)}</div>}</div><details className="trace-details"><summary>Decision trace <span>{current.tool_calls.length} policy tools</span></summary>{current.trace.map((item) => <div className="trace-line" key={item.step}><b>{item.step}</b><span>{item.detail}</span></div>)}</details></>}
        </> : <div className="empty-state">Select a message to review.</div>}</div>
      </section>
      <footer className="footnote">Synthetic take-home data · No real patient information · Date: {clinic?.today ?? "2026-11-09"}</footer>
    </main>
  </div>;
}
function Metric({ label, value, critical }: { label: string; value: string; critical?: boolean }) { return <div className={`metric ${critical ? "metric-critical" : ""}`}><small>{label}</small><strong>{value}</strong></div>; }
function subject(body: string) { const b = body.trim(); return b.length > 62 ? `${b.slice(0, 59).trim()}…` : b; }
function humanize(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()); }

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
