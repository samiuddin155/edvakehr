import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  IconActivity, IconAlertTriangle, IconArrowUpRight, IconBell, IconCalendarPlus, IconCalendarWeek,
  IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconClipboardText,
  IconClock, IconCopy, IconDeviceFloppy, IconDots, IconEdit, IconExternalLink, IconFileText,
  IconFilter, IconFlask, IconHeartRateMonitor, IconInbox, IconInfoCircle, IconLayoutDashboard,
  IconListCheck, IconMail, IconMenu2, IconMessageCircle, IconNotes, IconPhone, IconPill, IconPlus,
  IconRefresh, IconRobot, IconSearch, IconSend, IconSettings, IconShieldCheck, IconSparkles,
  IconStethoscope, IconUsers, IconX,
} from "@tabler/icons-react";
import "./style.css";
import edvakLogo from "../logo.svg";
import type { AgentResult, Appointment, ClinicConfig, IncomingMessage, Medication, Patient, RunEvaluation } from "../server/types.js";

type Page = "inbox" | "agent" | "patients" | "appointments" | "medications" | "evaluation" | "safety" | "settings";
type ReviewTab = "message" | "analysis" | "context" | "tools" | "timeline";
type SavedRun = AgentResult & { loading?: boolean; review_status?: "reviewed"; reviewed_at?: string; draft_updated_at?: string };
type QueueItem = { message_id: string; queue: string; reason: string; status: "open" | "resolved"; created_at?: string };
type Health = { ok: boolean; dataSource: string; modelConfigured: boolean; supabaseConfigured: boolean; messages: number; mcp: { connected: boolean; transport: string; tools: string[] } };
type Slot = Appointment;
type EvaluationResult = { results: SavedRun[]; evaluation: RunEvaluation; run: { mode: string; model: string; prompt_tokens: number; completion_tokens: number; cost: number | null } };
type IconName = "dashboard" | "inbox" | "robot" | "patients" | "calendar" | "pill" | "flask" | "shield" | "settings" | "activity" | "alert" | "check" | "down" | "left" | "right" | "copy" | "save" | "dots" | "edit" | "filter" | "info" | "mail" | "message" | "notes" | "phone" | "plus" | "refresh" | "search" | "send" | "sparkles" | "stethoscope" | "close" | "bell" | "clock" | "file" | "clipboard" | "external" | "calendarPlus" | "heart" | "arrowUp" | "menu" | "chevronUp" | "checklist";

const iconMap: Record<IconName, React.ComponentType<{ size?: number; stroke?: number; className?: string }>> = {
  dashboard: IconLayoutDashboard, inbox: IconInbox, robot: IconRobot, patients: IconUsers,
  calendar: IconCalendarWeek, pill: IconPill, flask: IconFlask, shield: IconShieldCheck,
  settings: IconSettings, activity: IconActivity, alert: IconAlertTriangle, check: IconCheck,
  down: IconChevronDown, left: IconChevronLeft, right: IconChevronRight, copy: IconCopy,
  save: IconDeviceFloppy, dots: IconDots, edit: IconEdit, filter: IconFilter,
  info: IconInfoCircle, mail: IconMail, message: IconMessageCircle, notes: IconNotes,
  phone: IconPhone, plus: IconPlus, refresh: IconRefresh, search: IconSearch,
  send: IconSend, sparkles: IconSparkles, stethoscope: IconStethoscope, close: IconX,
  bell: IconBell, clock: IconClock, file: IconFileText, clipboard: IconClipboardText,
  external: IconExternalLink, calendarPlus: IconCalendarPlus, heart: IconHeartRateMonitor,
  arrowUp: IconArrowUpRight, menu: IconMenu2, chevronUp: IconChevronUp,
  checklist: IconListCheck,
};

function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const Component = iconMap[name];
  return <Component size={size} stroke={1.8} className={className} aria-hidden="true" />;
}

const nav: Array<{ id: Page; label: string; icon: IconName }> = [
  { id: "inbox", label: "Inbox", icon: "inbox" }, { id: "agent", label: "AI Agent", icon: "robot" },
  { id: "patients", label: "Patients", icon: "patients" }, { id: "appointments", label: "Appointments", icon: "calendar" },
  { id: "medications", label: "Medications", icon: "pill" }, { id: "evaluation", label: "Evaluation Lab", icon: "flask" },
  { id: "safety", label: "Audit & Safety", icon: "shield" }, { id: "settings", label: "Settings", icon: "settings" },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
const initials = (name = "?") => name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
const humanize = (value = "") => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const toDate = (value?: string) => value ? new Date(`${value.slice(0, 10)}T12:00:00Z`) : null;
const formatDate = (value?: string) => { const date = toDate(value); return date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—"; };
const formatTime = (value?: string) => value ? new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—";
const percent = (value?: number) => `${Math.round((value ?? 0) * 100)}%`;
const getSubject = (body: string) => { const trimmed = body.trim(); return trimmed.length > 66 ? `${trimmed.slice(0, 63).trim()}…` : trimmed; };
const inferredCategory = (message: IncomingMessage) => {
  const body = message.body.toLowerCase();
  if (/refill|renew|more .*medication|more pills/.test(body)) return "refill";
  if (/appointment|reschedule|cancel|book|slot|physical|see .*week/.test(body)) return "appointment";
  if (/bill|balance|copay|insurance/.test(body)) return "billing";
  if (/record|lab result|vaccination/.test(body)) return "records";
  if (/chest pain|shortness of breath|can't finish sentences|bleeding/.test(body)) return "clinical";
  return "message";
};
const isEmergencyText = (body: string) => /chest pain|shortness of breath|can't finish sentences|dark stools|blood sugar.{0,20}(45|4[0-9])|hit .*head.{0,30}confus|not breathing/i.test(body);
const queueLabel = (queue: string) => humanize(queue.replace("clinician", "clinical"));
const dateAfter = (value: string, days: number) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };

function App() {
  const [page, setPage] = useState<Page>("inbox");
  const [clinic, setClinic] = useState<ClinicConfig | null>(null);
  const [messages, setMessages] = useState<IncomingMessage[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [results, setResults] = useState<Record<string, SavedRun>>({});
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [reviewTab, setReviewTab] = useState<ReviewTab>("message");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [evaluationMode, setEvaluationMode] = useState<"rules" | "model">("rules");
  const searchRef = useRef<HTMLInputElement>(null);

  const refreshAll = useCallback(async () => {
    const [inbox, status, savedRuns, savedQueues, patientData, medicationData, appointmentData] = await Promise.all([
      api<{ clinic: ClinicConfig; messages: IncomingMessage[] }>("/api/inbox"), api<Health>("/api/health"),
      api<{ runs: SavedRun[] }>("/api/runs"), api<{ items: QueueItem[] }>("/api/queues"),
      api<{ patients: Patient[] }>("/api/patients"), api<{ medications: Medication[] }>("/api/medications"),
      api<{ appointments: Appointment[] }>("/api/appointments"),
    ]);
    setClinic(inbox.clinic); setMessages(inbox.messages); setHealth(status);
    setResults(Object.fromEntries(savedRuns.runs.map((run) => [run.id, run]))); setQueueItems(savedQueues.items);
    setPatients(patientData.patients); setMedications(medicationData.medications); setAppointments(appointmentData.appointments);
    const savedEmergency = inbox.messages.find((message) => savedRuns.runs.some((run) => run.id === message.id && run.urgency === "emergency"));
    setSelectedId((selected) => selected || savedEmergency?.id || inbox.messages[0]?.id || "");
  }, []);

  useEffect(() => { void refreshAll().catch((caught) => setError(caught instanceof Error ? caught.message : "The API is not reachable.")); }, [refreshAll]);
  useEffect(() => { setDraft(results[selectedId]?.reply_draft ?? ""); setReviewTab("message"); }, [selectedId, results[selectedId]?.reply_draft]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);

  const selected = messages.find((message) => message.id === selectedId);
  const current = results[selectedId];
  const openQueues = queueItems.filter((item) => item.status === "open");
  const needsReview = messages.filter((message) => !results[message.id]?.review_status).length;
  const emergencies = Object.values(results).filter((result) => result.urgency === "emergency").length;
  const visibleMessages = useMemo(() => messages.filter((message) => {
    const result = results[message.id]; const content = `${message.id} ${message.from_name} ${message.from_contact} ${message.channel} ${message.body}`.toLowerCase();
    if (search && !content.includes(search.toLowerCase())) return false;
    if (filter === "needs-review" && result?.review_status === "reviewed") return false;
    if (filter === "emergency" && !(result?.urgency === "emergency" || isEmergencyText(message.body))) return false;
    if (filter === "appointments" && (result?.intents.includes("schedule") || result?.intents.includes("reschedule") || result?.intents.includes("cancel") || inferredCategory(message) === "appointment") === false) return false;
    if (filter === "refills" && !(result?.intents.includes("refill") || inferredCategory(message) === "refill")) return false;
    if (filter === "billing" && !(result?.intents.includes("billing") || inferredCategory(message) === "billing")) return false;
    if (filter === "unprocessed" && result) return false;
    return true;
  }).sort((first, second) => {
    const firstUrgent = results[first.id]?.urgency === "emergency" || isEmergencyText(first.body);
    const secondUrgent = results[second.id]?.urgency === "emergency" || isEmergencyText(second.body);
    return Number(secondUrgent) - Number(firstUrgent);
  }), [messages, results, filter, search]);

  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3400); };

  async function processMessage(id = selectedId) {
    if (!id) return;
    const previousResult = results[id];
    setLoading(true); setError("");
    try {
      const result = await api<SavedRun>(`/api/process/${encodeURIComponent(id)}`, { method: "POST" });
      setResults((old) => ({ ...old, [id]: result })); setDraft(result.reply_draft);
      const queues = await api<{ items: QueueItem[] }>("/api/queues"); setQueueItems(queues.items);
      showNotice(result.mode === "openrouter" ? "Message analyzed and saved to Supabase." : "Message reviewed with local safety rules and saved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Processing failed."); if (!previousResult) setResults((old) => { const next = { ...old }; delete next[id]; return next; }); }
    finally { setLoading(false); }
  }

  async function runEvaluation(mode: "rules" | "model" = evaluationMode) {
    setLoading(true); setError("");
    try {
      const response = await api<EvaluationResult>("/api/evaluate", { method: "POST", body: JSON.stringify({ analysisMode: mode, persist: true }) });
      setEvaluation(response); setResults(Object.fromEntries(response.results.map((result) => [result.id, result])));
      const queues = await api<{ items: QueueItem[] }>("/api/queues"); setQueueItems(queues.items);
      showNotice(`${mode === "rules" ? "Rules baseline" : response.run.model} finished for ${response.evaluation.total} synthetic messages.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Evaluation failed."); }
    finally { setLoading(false); }
  }

  async function saveDraft() {
    if (!selected || !current) return;
    setLoading(true); setError("");
    try { const saved = await api<{ result: SavedRun }>(`/api/runs/${encodeURIComponent(selected.id)}/draft`, { method: "PATCH", body: JSON.stringify({ reply_draft: draft }) }); setResults((old) => ({ ...old, [selected.id]: saved.result })); showNotice("Draft saved. It has not been sent."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save draft."); }
    finally { setLoading(false); }
  }

  async function markReviewed() {
    if (!selected || !current) return;
    setLoading(true); setError("");
    try { const saved = await api<{ result: SavedRun }>(`/api/runs/${encodeURIComponent(selected.id)}/review`, { method: "POST" }); setResults((old) => ({ ...old, [selected.id]: saved.result })); showNotice("Staff review recorded. No patient message was sent."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not record review."); }
    finally { setLoading(false); }
  }

  async function resolveQueue(item: QueueItem) {
    try { await api(`/api/queues/${encodeURIComponent(item.message_id)}/${encodeURIComponent(item.queue)}/resolve`, { method: "POST" }); setQueueItems((old) => old.map((entry) => entry.message_id === item.message_id && entry.queue === item.queue ? { ...entry, status: "resolved" } : entry)); showNotice("Queue item marked resolved."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update queue."); }
  }

  async function refresh() { setLoading(true); setError(""); try { await refreshAll(); showNotice("Clinic workspace refreshed."); } catch (caught) { setError(caught instanceof Error ? caught.message : "Refresh failed."); } finally { setLoading(false); } }

  const pageTitle = nav.find((item) => item.id === page)?.label ?? "Inbox";
  const placeholder = page === "patients" ? "Search patients by name or ID…" : page === "appointments" ? "Search appointments…" : page === "medications" ? "Search medications…" : "Search messages, patients, or IDs…";

  return <div className="app-frame">
    <aside className="sidebar">
      <div className="brand"><span className="brand-logo-frame"><img className="brand-logo" src={edvakLogo} alt="Edvak Health"/></span><div className="brand-type"><strong>FORGE</strong><small>AI Front Desk Agent</small></div><button className="mobile-menu" aria-label="Open navigation"><Icon name="menu"/></button></div>
      <div className="clinic-switcher"><div className="clinic-glyph"><Icon name="stethoscope" size={18}/></div><div className="clinic-text"><strong>{clinic?.clinic_name.split(" (")[0] ?? "Maplewood Family Clinic"}</strong><small>Demo workspace</small></div><Icon name="down" size={14}/></div>
      <div className="nav-caption">Workspace</div>
      <nav className="main-nav" aria-label="Main navigation">{nav.map((item) => <button key={item.id} aria-current={page === item.id ? "page" : undefined} className={`nav-link ${page === item.id ? "active" : ""}`} onClick={() => { setPage(item.id); setSearch(""); }}><Icon name={item.icon}/><span>{item.label}</span>{item.id === "inbox" && needsReview > 0 && <b>{needsReview}</b>}{item.id === "safety" && openQueues.length > 0 && <b className="nav-alert-count">{openQueues.length}</b>}</button>)}</nav>
      <div className="sidebar-spacer"/>
      <div className="side-system-card"><div className={`system-dot ${health?.ok && health.mcp?.connected ? "live" : "offline"}`}/><div><strong>{health?.ok && health.mcp?.connected ? "All systems operational" : "Connection needs attention"}</strong><small>{health?.dataSource === "supabase" ? "Supabase · MCP stdio" : "Checking clinic services…"}</small></div></div>
      <div className="side-profile"><div className="profile-avatar">JD</div><div><strong>Jamie Doe</strong><small>Front Desk</small></div><button onClick={() => setPage("settings")} aria-label="Open settings"><Icon name="settings" size={17}/></button></div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <label className="global-search"><Icon name="search" size={18}/><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={placeholder}/><kbd>⌘ K</kbd></label>
        <div className="topbar-right"><div className="demo-date"><Icon name="calendar" size={16}/><span>{clinic?.today ? formatDate(clinic.today) : "Loading clinic date"}</span></div><div className="notification-wrap"><button className={`top-icon ${notificationsOpen ? "pressed" : ""}`} aria-label="Notifications" onClick={() => setNotificationsOpen((open) => !open)}><Icon name="bell"/><i className={openQueues.length ? "has-alert" : ""}/></button>{notificationsOpen && <div className="notification-menu"><strong>Staff queues</strong>{openQueues.length ? openQueues.slice(0, 5).map((item) => <button key={`${item.message_id}-${item.queue}`} onClick={() => { setPage("safety"); setNotificationsOpen(false); }}><span className="mini-alert"><Icon name="alert" size={14}/></span><span><b>{queueLabel(item.queue)}</b><small>{item.reason}</small></span></button>) : <p>All queues are clear.</p>}</div>}</div><button className="user-chip" onClick={() => setPage("settings")}><span>JD</span><b>Jamie Doe</b><Icon name="down" size={14}/></button></div>
      </header>
      <div className="page-content">
        {error && <div className="toast toast-error" role="alert"><Icon name="alert" size={17}/>{error}<button onClick={() => setError("")} aria-label="Dismiss error"><Icon name="close" size={16}/></button></div>}
        {notice && <div className="toast toast-success" role="status"><Icon name="check" size={17}/>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message"><Icon name="close" size={16}/></button></div>}
        {page === "inbox" && <InboxPage clinic={clinic} messages={messages} patients={patients} appointmentsCount={appointments.length} medicationCount={medications.length} results={results} queueItems={queueItems} health={health} visible={visibleMessages} selected={selected} current={current} selectedId={selectedId} setSelectedId={setSelectedId} filter={filter} setFilter={setFilter} reviewTab={reviewTab} setReviewTab={setReviewTab} draft={draft} setDraft={setDraft} loading={loading} onProcess={() => void processMessage()} onReview={() => void markReviewed()} onSaveDraft={() => void saveDraft()} onResolveQueue={(item) => void resolveQueue(item)} onNavigate={setPage} onRunEvaluation={runEvaluation} evaluation={evaluation} evaluationMode={evaluationMode} setEvaluationMode={setEvaluationMode} onError={setError} />}
        {page === "agent" && <AgentPage health={health} results={Object.values(results)} patients={patients} onRefresh={() => void refresh()} onNavigate={setPage} loading={loading} onError={setError} onProcessed={(message, result) => { setMessages((old) => [message, ...old]); setResults((old) => ({ ...old, [result.id]: result })); setSelectedId(result.id); setReviewTab("message"); setPage("inbox"); void refresh(); showNotice("Synthetic test analyzed. Review the result in the inbox; no patient message was sent."); }}/>}
        {page === "patients" && <PatientsPage patients={patients} appointments={appointments} medications={medications} search={search} onOpenInbox={(id) => { const patient = patients.find((item) => item.id === id); const message = messages.find((item) => results[item.id]?.patient_id === id || item.from_name === patient?.name); setSelectedId(message?.id ?? ""); setPage("inbox"); }}/>}
        {page === "appointments" && <AppointmentsPage clinic={clinic} patients={patients} appointments={appointments} search={search} onRefresh={refresh} onNotice={showNotice} onError={setError}/>}
        {page === "medications" && <MedicationsPage patients={patients} medications={medications} search={search} onError={setError} onNotice={showNotice} onNavigate={setPage} onOpenInbox={(id) => { setSelectedId(id); setPage("inbox"); }}/>}
        {page === "evaluation" && <EvaluationPage evaluation={evaluation} results={Object.values(results)} mode={evaluationMode} setMode={setEvaluationMode} loading={loading} onRun={() => void runEvaluation()} onError={setError} health={health}/>}
        {page === "safety" && <SafetyPage results={Object.values(results)} queues={queueItems} health={health} onResolve={(item) => void resolveQueue(item)}/>}
        {page === "settings" && <SettingsPage health={health} clinic={clinic} onRefresh={() => void refresh()} loading={loading}/>}
      </div>
    </main>
  </div>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="header-action">{action}</div>}</div>;
}
function PrimaryButton({ children, onClick, disabled, icon = "sparkles", variant = "primary" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; icon?: IconName; variant?: "primary" | "secondary" | "danger" }) {
  return <button className={`button ${variant}`} onClick={onClick} disabled={disabled}>{disabled ? <span className="spinner"/> : <Icon name={icon} size={17}/>}<span>{children}</span></button>;
}
function StatCard({ label, value, note, icon, tone }: { label: string; value: string | number; note: string; icon: IconName; tone: string }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon name={icon}/></div><div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>;
}
function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) { return <span className={`pill ${tone}`}>{children}</span>; }
function PersonAvatar({ name, size = "normal", tone }: { name: string; size?: "normal" | "large"; tone?: string }) { return <div className={`person-avatar ${size} ${tone ?? ""}`}>{initials(name)}</div>; }

function InboxPage(props: {
  clinic: ClinicConfig | null; messages: IncomingMessage[]; patients: Patient[]; results: Record<string, SavedRun>; queueItems: QueueItem[]; health: Health | null;
  visible: IncomingMessage[]; selected?: IncomingMessage; current?: SavedRun; selectedId: string; setSelectedId: (id: string) => void; filter: string; setFilter: (filter: string) => void;
  reviewTab: ReviewTab; setReviewTab: (tab: ReviewTab) => void; draft: string; setDraft: (draft: string) => void; loading: boolean; onProcess: () => void; onReview: () => void;
  onSaveDraft: () => void; onResolveQueue: (item: QueueItem) => void; onNavigate: (page: Page) => void; onRunEvaluation: (mode?: "rules" | "model") => Promise<void>;
  evaluation: EvaluationResult | null; evaluationMode: "rules" | "model"; setEvaluationMode: (mode: "rules" | "model") => void;
  appointmentsCount: number; medicationCount: number; onError: (message: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const { clinic, messages, results, queueItems, health, visible, selected, current, selectedId, setSelectedId, filter, setFilter, reviewTab, setReviewTab, draft, setDraft, loading, onProcess, onReview, onSaveDraft, onResolveQueue, onNavigate, evaluation, evaluationMode, setEvaluationMode, onRunEvaluation, appointmentsCount, medicationCount, onError } = props;
  const unresolved = queueItems.filter((item) => item.status === "open");
  const reviewed = Object.values(results).filter((item) => item.review_status === "reviewed").length;
  const verifiedPatient = current?.verification === "verified" ? props.patients.find((patient) => patient.id === current.patient_id) : undefined;
  const selectedQueueItems = unresolved.filter((item) => item.message_id === selected?.id);
  const tabs: Array<{ id: ReviewTab; label: string; icon: IconName }> = [
    { id: "message", label: "Message", icon: "message" }, { id: "analysis", label: "AI Analysis", icon: "sparkles" },
    { id: "context", label: "Patient Context", icon: "patients" }, { id: "tools", label: "Tool Calls", icon: "activity" }, { id: "timeline", label: "Timeline", icon: "clock" },
  ];

  return <>
    <PageHeader eyebrow="Patient communications" title="Front Desk Inbox" description="Review the message, confirm the context, and route the next step." action={<><button className="button secondary" onClick={() => onNavigate("agent")}><Icon name="message" size={16}/> Try a message</button><button className="button secondary" onClick={() => onNavigate("evaluation")}><Icon name="flask" size={16}/> Evaluation Lab</button><PrimaryButton onClick={onProcess} disabled={loading || !selected}>{loading ? "Analyzing" : "Process with AI"}</PrimaryButton></>}/>
    <div className="stat-grid">
      <StatCard label="Inbox messages" value={messages.length} note={`${reviewed} reviewed by staff`} icon="inbox" tone="violet"/>
      <StatCard label="Needs review" value={messages.length - reviewed} note="Drafts stay unsent" icon="clock" tone="amber"/>
      <StatCard label="Emergencies" value={Object.values(results).filter((result) => result.urgency === "emergency").length} note="From analyzed messages" icon="alert" tone="rose"/>
      <StatCard label="Appointments" value={props.appointmentsCount ?? "—"} note="Clinic schedule" icon="calendar" tone="blue"/>
      <StatCard label="Open queues" value={unresolved.length} note="Waiting for a staff member" icon="shield" tone="teal"/>
    </div>
    <section className="inbox-workspace">
      <div className="inbox-column">
        <div className="panel-heading"><div><strong>Messages</strong><span className="quiet-count">{visible.length}</span></div><button className="icon-button" title="Search messages"><Icon name="filter"/></button></div>
        <div className="filter-strip" role="tablist" aria-label="Message filters">{[
          ["all", "All"], ["needs-review", "Needs review"], ["emergency", "Urgent"], ["appointments", "Appointments"], ["refills", "Refills"], ["billing", "Billing"],
        ].map(([id, label]) => <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? "filter-chip selected" : "filter-chip"} onClick={() => setFilter(id)}>{label}{id === "all" && <span>{messages.length}</span>}</button>)}</div>
        <div className="message-list">{visible.map((message) => {
          const result = results[message.id]; const selectedRow = message.id === selectedId;
          return <button key={message.id} className={`message-row ${selectedRow ? "selected" : ""} ${result?.urgency === "emergency" || isEmergencyText(message.body) ? "row-emergency" : ""}`} onClick={() => setSelectedId(message.id)}>
            <PersonAvatar name={message.from_name} tone={result?.urgency === "emergency" || isEmergencyText(message.body) ? "emergency-avatar" : inferredCategory(message)}/>
            <span className="message-row-copy"><span className="message-row-top"><strong>{message.from_name}</strong><time>{formatTime(message.received_at)}</time></span><span className="message-subject">{getSubject(message.body)}</span><span className="message-row-bottom"><Pill tone={inferredCategory(message)}>{humanize(inferredCategory(message))}</Pill>{(result?.urgency === "emergency" || isEmergencyText(message.body)) && <Pill tone="emergency">Emergency</Pill>}{result?.review_status === "reviewed" && <span className="reviewed-mark"><Icon name="check" size={12}/> Reviewed</span>}</span></span>
          </button>;
        })}{visible.length === 0 && <div className="empty-message"><Icon name="search"/><strong>No messages match</strong><span>Try another search or filter.</span></div>}</div>
        <div className="list-footer"><span><i className="system-dot live"/> {health?.dataSource === "supabase" ? "Live Supabase data" : "Local fixture data"}</span><button className="icon-button" title="Refresh inbox" onClick={() => window.location.reload()}><Icon name="refresh" size={16}/></button></div>
      </div>
      <div className="conversation-column">
        {selected ? <>
          <div className="conversation-head"><div><div className="eyebrow">Selected message <span className="id-code">{selected.id}</span></div><h2>{getSubject(selected.body)}</h2></div><div className="message-arrows"><span>{messages.findIndex((message) => message.id === selected.id) + 1} of {messages.length}</span><button aria-label="Previous message" onClick={() => { const i = messages.findIndex((message) => message.id === selected.id); setSelectedId(messages[(i - 1 + messages.length) % messages.length]?.id ?? selected.id); }}><Icon name="left" size={16}/></button><button aria-label="Next message" onClick={() => { const i = messages.findIndex((message) => message.id === selected.id); setSelectedId(messages[(i + 1) % messages.length]?.id ?? selected.id); }}><Icon name="right" size={16}/></button></div></div>
          <div className="sender-line"><PersonAvatar name={selected.from_name} size="large"/><div className="sender-info"><strong>{selected.from_name}</strong><span>{current?.verification === "verified" && current.patient_id ? `${current.patient_id} · Verified patient` : "Identity not verified"} <b>·</b> {selected.channel}</span></div><div className="sender-time">Received {formatDate(selected.received_at)} · {formatTime(selected.received_at)}</div></div>
          <div className="review-tabs" role="tablist">{tabs.map((tab) => <button key={tab.id} role="tab" aria-selected={reviewTab === tab.id} className={reviewTab === tab.id ? "review-tab active" : "review-tab"} onClick={() => setReviewTab(tab.id)}><Icon name={tab.icon} size={15}/>{tab.label}{tab.id === "tools" && current && <small>{current.tool_calls?.length ?? 0}</small>}</button>)}</div>
          <motion.div className="conversation-body" key={`${selected.id}-${reviewTab}`} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}>
            {reviewTab === "message" && <div className="message-view"><div className="message-meta"><span><Icon name={selected.channel === "sms" ? "phone" : selected.channel === "email" ? "mail" : "message"} size={15}/>{humanize(selected.channel)}</span><span>{formatDate(selected.received_at)} at {formatTime(selected.received_at)}</span></div><div className="incoming-bubble"><p>{selected.body}</p></div>{current ? <div className="draft-editor"><div className="draft-title"><span><Icon name="file" size={16}/> Suggested reply</span><Pill tone="draft">NOT SENT · REVIEW REQUIRED</Pill></div>{current.urgency === "emergency" && <div className="emergency-note"><Icon name="alert" size={16}/><span>Emergency policy: the response must direct the sender to 911 or the nearest emergency department and say the clinic has been alerted.</span></div>}<textarea value={draft} maxLength={2000} onChange={(event) => setDraft(event.target.value)} aria-label="Edit suggested reply"/><div className="draft-footer"><span>{draft.length}/2000 · Nothing is sent from this prototype.</span><div><button className="button secondary compact" onClick={() => void (async () => { try { await navigator.clipboard.writeText(draft); } catch { /* clipboard may be unavailable in the local browser */ } })()}><Icon name="copy" size={15}/> Copy draft</button><button className="button primary compact" onClick={props.onSaveDraft} disabled={loading}><Icon name="save" size={15}/> Save draft</button></div></div></div> : <div className="message-awaiting"><div className="awaiting-icon"><Icon name="sparkles"/></div><div><strong>Ready for a safe review</strong><p>Analyze this message to check identity, classify urgency, apply clinic rules, and create a staff-reviewed draft.</p></div><PrimaryButton onClick={onProcess} disabled={loading}>{loading ? "Analyzing" : "Analyze message"}</PrimaryButton></div>}</div>}
            {reviewTab === "analysis" && <AnalysisView current={current} loading={loading} onProcess={onProcess}/>}
            {reviewTab === "context" && <PatientContext patient={verifiedPatient} current={current}/>}
            {reviewTab === "tools" && <ToolCallsView current={current}/>}
            {reviewTab === "timeline" && <TimelineView message={selected} current={current} queues={queueItems.filter((item) => item.message_id === selected.id)}/>}
          </motion.div>
          {selectedQueueItems.length > 0 && <div className="queue-alert-row">{selectedQueueItems.map((item) => <div key={`${item.message_id}-${item.queue}`} className="queue-alert"><span><Icon name="alert" size={16}/><b>{queueLabel(item.queue)}</b><small>{item.reason}</small></span><button className="button secondary compact" onClick={() => onResolveQueue(item)}><Icon name="check" size={14}/> Resolve</button></div>)}</div>}
          <div className="conversation-actions">{current ? <><button className="button secondary" onClick={() => void navigator.clipboard?.writeText(current.reply_draft)}><Icon name="copy" size={16}/> Copy draft</button><span className="no-send-note"><Icon name="shield" size={15}/> Staff approval required · not sent</span><button className={`button ${current.review_status === "reviewed" ? "review-complete" : "primary"}`} onClick={onReview} disabled={loading || current.review_status === "reviewed"}><Icon name="check" size={16}/>{current.review_status === "reviewed" ? "Review recorded" : "Mark reviewed"}</button></> : <span className="no-send-note"><Icon name="info" size={15}/> Analyze a message before marking it reviewed.</span>}</div>
        </> : <div className="empty-workspace"><Icon name="inbox" size={34}/><strong>Your inbox is clear</strong><span>Choose a message from the list to begin.</span></div>}
      </div>
      <AssistantPanel selected={selected} current={current} health={health} loading={loading} onProcess={onProcess} onNavigate={onNavigate} onReview={onReview}/>
    </section>
    <section className="support-grid">
      <QuickAppointments clinic={clinic} appointmentCount={appointmentsCount} onNavigate={onNavigate}/>
      <QuickRefills medications={medicationCount} queueItems={queueItems} onNavigate={onNavigate}/>
      <QuickEvaluation evaluation={evaluation} count={messages.length} mode={evaluationMode} setMode={setEvaluationMode} onRun={() => void onRunEvaluation()} loading={loading} onNavigate={onNavigate}/>
    </section>
    <div className="privacy-footnote"><Icon name="shield" size={14}/> Synthetic take-home data only <span>·</span> Clinic date {formatDate(clinic?.today)}</div>
  </>;
}

function AnalysisView({ current, loading, onProcess }: { current?: SavedRun; loading: boolean; onProcess: () => void }) {
  if (!current) return <div className="tab-empty"><div className="tab-empty-icon"><Icon name="sparkles"/></div><strong>No analysis yet</strong><p>Run the assistant to see the intent, urgency, and policy actions for this message.</p><PrimaryButton onClick={onProcess} disabled={loading}>{loading ? "Analyzing" : "Analyze message"}</PrimaryButton></div>;
  return <div className="analysis-view"><div className={`analysis-summary ${current.urgency}`}><div className="analysis-summary-top"><span><Icon name="sparkles" size={17}/> Agent assessment</span><Pill tone={current.urgency}>{humanize(current.urgency)} urgency</Pill></div><h3>{humanize(current.intents.join(" + ") || "Other")}</h3><p>{current.trace.find((step) => step.step === "classification")?.detail ?? `Reviewed in ${current.mode} mode.`}</p></div><div className="analysis-section"><div className="analysis-label">Suggested actions</div><div className="action-list">{current.actions.map((action) => <div key={action}><span className="action-check"><Icon name="check" size={13}/></span><span>{humanize(action)}</span></div>)}</div></div><div className="analysis-section"><div className="analysis-label">Human routing</div>{current.routed_to.length ? current.routed_to.map((queue) => <div className="route-item" key={queue}><span className="route-indicator"/><span><b>{queueLabel(queue)}</b><small>{current.queue_reasons?.find((item) => item.queue === queue)?.reason ?? "Requires staff follow-up."}</small></span><Pill tone="waiting">Open</Pill></div>) : <p className="muted-copy">No human queue was created for this message.</p>}</div><div className="analysis-section model-note"><span><Icon name="robot" size={16}/>{current.model}</span><span>{current.usage.prompt_tokens + current.usage.completion_tokens} tokens</span></div></div>;
}

function PatientContext({ patient, current }: { patient?: Patient; current?: SavedRun }) {
  if (!patient || current?.verification !== "verified") return <div className="privacy-guard"><span><Icon name="shield" size={22}/></span><strong>Patient context is protected</strong><p>The clinic only shows patient details after the sender matches an exact phone/email or name and date of birth in the fixture.</p><Pill tone="neutral">{current?.verification === "new_patient" ? "New patient" : "Not verified"}</Pill></div>;
  return <div className="patient-context"><div className="patient-context-head"><PersonAvatar name={patient.name} size="large"/><div><strong>{patient.name}</strong><span>{patient.id} · Verified patient</span></div><Pill tone="success"><Icon name="check" size={12}/> Verified</Pill></div><div className="context-grid"><ContextItem label="Date of birth" value={formatDate(patient.dob)}/><ContextItem label="Phone" value={patient.phone}/><ContextItem label="Email" value={patient.email}/><ContextItem label="Primary provider" value={patient.primary_provider}/><ContextItem label="Last visit" value={formatDate(patient.last_visit)}/><ContextItem label="Preferred language" value={patient.preferred_language}/></div><div className="context-block"><strong>Allergies</strong><p>{patient.allergies.length ? patient.allergies.join(", ") : "None listed in the synthetic record."}</p></div>{patient.authorised_caregiver && <div className="context-block"><strong>Authorized caregiver</strong><p>{patient.authorised_caregiver.name} · {patient.authorised_caregiver.relationship}</p></div>}</div>;
}
function ContextItem({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value || "—"}</strong></div>; }

function ToolCallsView({ current }: { current?: SavedRun }) {
  if (!current) return <div className="tab-empty"><div className="tab-empty-icon"><Icon name="activity"/></div><strong>No tool calls yet</strong><p>MCP calls appear here after the assistant processes a message.</p></div>;
  const toolCalls = current.tool_calls ?? [];
  return <div className="tool-view"><div className="tab-intro"><div><strong>Clinic MCP calls</strong><small>One stdio session · deterministic clinic tools</small></div><Pill tone="success"><Icon name="check" size={12}/> {toolCalls.length} calls</Pill></div>{toolCalls.map((tool, index) => <div className="tool-call-row" key={`${tool}-${index}`}><span className="tool-step">{String(index + 1).padStart(2, "0")}</span><span className="tool-ok"><Icon name="check" size={13}/></span><span><b>{tool}</b><small>{toolDetail(tool)}</small></span><Pill tone="success">Complete</Pill></div>)}<details className="trace-accordion"><summary><Icon name="notes" size={15}/> Decision trace <Icon name="down" size={14}/></summary>{(current.trace ?? []).map((step) => <div key={step.step}><b>{humanize(step.step)}</b><p>{step.detail}</p></div>)}</details></div>;
}
function toolDetail(tool: string) { const details: Record<string, string> = { set_current_message: "Bound the selected message and its fixture context.", find_patient: "Checked exact sender contact and identity evidence.", get_patient_medications: "Read active medications for a verified patient.", check_refill_eligibility: "Applied deterministic clinic refill policy.", get_patient_appointments: "Read booked appointments for a verified patient.", find_appointment_slots: "Checked provider hours, leave, holidays, and overlaps.", book_appointment: "Created a booking after identity and conflict checks.", reschedule_appointment: "Moved a verified appointment after conflict checks.", cancel_appointment: "Cancelled a verified appointment.", route_message: "Placed the message in a staff-owned queue.", draft_reply: "Saved a draft for human review; no message was sent." }; return details[tool] ?? "Executed by the clinic MCP server."; }

function TimelineView({ message, current, queues }: { message: IncomingMessage; current?: SavedRun; queues: QueueItem[] }) {
  const entries = [{ label: "Message received", detail: `${humanize(message.channel)} · ${formatDate(message.received_at)} at ${formatTime(message.received_at)}`, complete: true }, { label: "Agent analysis", detail: current ? `${current.model} · ${humanize(current.urgency)} urgency` : "Waiting for analysis", complete: Boolean(current) }, { label: "Routed to staff", detail: queues.length ? queues.map((item) => queueLabel(item.queue)).join(" · ") : current?.routed_to.length ? current.routed_to.map(queueLabel).join(" · ") : "No route recorded", complete: Boolean(current?.routed_to.length) }, { label: "Staff review", detail: current?.review_status === "reviewed" ? `Review recorded ${formatDate(current.reviewed_at)}` : "Pending staff review · no send action", complete: current?.review_status === "reviewed" }];
  return <div className="timeline-view">{entries.map((entry) => <div key={entry.label} className={`timeline-entry ${entry.complete ? "complete" : ""}`}><span className="timeline-node">{entry.complete ? <Icon name="check" size={13}/> : null}</span><div><strong>{entry.label}</strong><p>{entry.detail}</p></div></div>)}</div>;
}

function AssistantPanel({ selected, current, health, loading, onProcess, onNavigate, onReview }: { selected?: IncomingMessage; current?: SavedRun; health: Health | null; loading: boolean; onProcess: () => void; onNavigate: (page: Page) => void; onReview: () => void }) {
  const reduceMotion = useReducedMotion();
  const staffReviewed = current?.review_status === "reviewed";
  const workflowProgress = staffReviewed ? "1" : current || loading ? "0.5" : "0";
  return <aside className="assistant-column">
    <div className="assistant-heading"><div><div className="eyebrow">Edvak assistant</div><h3>AI front desk <Pill tone="beta">BETA</Pill></h3></div><span className="assistant-live"><i className={`system-dot ${health?.mcp?.connected ? "live" : "offline"}`}/>{health?.mcp?.connected ? "Connected" : "Connecting"}</span></div>
    <div className="assistant-character"><img src="/web/assets/edvak-owl.png" alt="Teal clinic owl assistant wearing a stethoscope"/><div><strong>{current ? current.urgency === "emergency" ? "This needs a human now." : "I’ve prepared a safe next step." : "Your clinic sidekick is ready."}</strong><p>{current ? current.urgency === "emergency" ? "I flagged this for the urgent clinician queue. The draft stays unsent." : "Review the context and draft, then record your staff review." : "Pick a message and I’ll check the clinic rules before suggesting a response."}</p></div></div>
    {selected && <ol className="agent-workflow" aria-label="Message workflow" style={{ "--workflow-progress": workflowProgress } as React.CSSProperties}>
      <li className="workflow-step done"><span>1</span><small>Received</small></li>
      <li className={`workflow-step ${current ? "done" : loading ? "active" : "next"}`} aria-current={!current && (loading || !selected) ? "step" : undefined}><span>{current ? <Icon name="check" size={12}/> : "2"}</span><small>{loading ? "Checking" : "MCP checks"}</small></li>
      <li className={`workflow-step ${staffReviewed ? "done" : current ? "active" : "next"}`} aria-current={current && !staffReviewed ? "step" : undefined}><span>{staffReviewed ? <Icon name="check" size={12}/> : "3"}</span><small>Staff review</small></li>
    </ol>}
    {!selected && <div className="assistant-empty"><Icon name="inbox"/><strong>Select a message</strong><span>The assistant will keep the human in control.</span></div>}
    {selected && !current && <div className="assistant-ready"><div className="ready-icon"><Icon name="sparkles"/></div><div><strong>Ready to review</strong><p>Check identity, intent, urgency, and policy before drafting.</p></div><PrimaryButton onClick={onProcess} disabled={loading}>{loading ? "Analyzing" : "Analyze message"}</PrimaryButton><small>One message · model access checked when run</small></div>}
    <AnimatePresence mode="wait" initial={false}>
    {current && <motion.div key={`${selected?.id}-${current.mode}-${current.usage.prompt_tokens}-${current.usage.completion_tokens}`} className={`assistant-result ${current.urgency}`} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -4 }} transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}><div className="result-title"><span><Icon name={current.urgency === "emergency" ? "alert" : "activity"} size={17}/>{current.urgency === "emergency" ? "Urgent attention" : "Recommended next step"}</span><Pill tone={current.urgency}>{humanize(current.urgency)}</Pill></div><h4>{humanize(current.actions?.[0] ?? current.intents?.[0] ?? "Review message")}</h4><p>{current.urgency === "emergency" ? "Escalate to clinician now. The patient draft includes emergency instructions and remains unsent." : current.reply_draft}</p>{current.mode !== "openrouter" && <small className="model-fallback-note">Local rules were used. Check OpenRouter access before relying on model analysis.</small>}{(current.routed_to ?? []).map((queue) => <div className="assistant-route" key={queue}><span className="route-indicator"/><b>{queueLabel(queue)}</b><small>Human queue</small></div>)}<div className="assistant-safety"><Icon name="shield" size={15}/><span>{current.verification === "verified" ? "Identity verified" : "No protected patient details disclosed"}</span></div><div className="assistant-actions"><button className="button secondary compact" onClick={() => onNavigate("safety")}><Icon name="activity" size={15}/> View trace</button><button className={`button ${current.review_status === "reviewed" ? "review-complete" : "primary"} compact`} onClick={onReview} disabled={loading || current.review_status === "reviewed"}><Icon name="check" size={15}/>{current.review_status === "reviewed" ? "Reviewed" : "Mark reviewed"}</button></div></motion.div>}
    </AnimatePresence>
    <div className="assistant-connection"><div><span className="system-dot live"/><strong>MCP stdio</strong><small>{health?.mcp?.tools.length ?? 0} clinic tools</small></div><div><span className={`system-dot ${health?.supabaseConfigured ? "live" : "offline"}`}/><strong>Supabase</strong><small>{health?.dataSource === "supabase" ? "Data + saved runs" : "Not connected"}</small></div></div>
  </aside>;
}

function QuickAppointments({ clinic, appointmentCount, onNavigate }: { clinic: ClinicConfig | null; appointmentCount: number; onNavigate: (page: Page) => void }) {
  return <section className="support-card appointment-quick"><div className="support-heading"><div className="support-icon blue"><Icon name="calendarPlus"/></div><div><strong>Appointment desk</strong><small>{appointmentCount} fixture bookings loaded</small></div><button className="text-link" onClick={() => onNavigate("appointments")}>Open schedule <Icon name="arrowUp" size={14}/></button></div><div className="appointment-summary"><div className="date-block"><span>{clinic?.today ? new Date(`${clinic.today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }) : "—"}</span><strong>{clinic?.today ? new Date(`${clinic.today}T12:00:00Z`).getUTCDate() : "—"}</strong><small>{clinic?.today ? new Date(`${clinic.today}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) : ""}</small></div><div className="appointment-summary-copy"><strong>Clinic hours</strong><span>{clinic?.hours.days.join(" · ")} · {clinic?.hours.open}–{clinic?.hours.close}</span><small>Slot search checks lunch, holidays, provider leave, and overlaps through MCP.</small></div><button className="button secondary compact" onClick={() => onNavigate("appointments")}><Icon name="plus" size={15}/> Book</button></div></section>;
}
function QuickRefills({ medications, queueItems, onNavigate }: { medications: number; queueItems: QueueItem[]; onNavigate: (page: Page) => void }) {
  const waiting = queueItems.filter((item) => item.queue === "provider_refills" && item.status === "open").length;
  return <section className="support-card refill-quick"><div className="support-heading"><div className="support-icon teal"><Icon name="pill"/></div><div><strong>Medication review</strong><small>{medications} active fixture records</small></div><button className="text-link" onClick={() => onNavigate("medications")}>Review meds <Icon name="arrowUp" size={14}/></button></div><div className="refill-summary"><div className="refill-line"><span className="refill-symbol"><Icon name="pill" size={16}/></span><div><strong>Provider review queue</strong><small>Eligible refills still require prescriber approval.</small></div><b>{waiting}</b></div><div className="policy-note"><Icon name="info" size={14}/> The assistant never approves or sends a prescription.</div></div></section>;
}
function QuickEvaluation({ evaluation, count, mode, setMode, onRun, loading, onNavigate }: { evaluation: EvaluationResult | null; count: number; mode: "rules" | "model"; setMode: (mode: "rules" | "model") => void; onRun: () => void; loading: boolean; onNavigate: (page: Page) => void }) {
  return <section className="support-card evaluation-quick"><div className="support-heading"><div className="support-icon violet"><Icon name="flask"/></div><div><strong>Evaluation Lab</strong><small>{evaluation ? `${evaluation.evaluation.total} messages · ${evaluation.run.mode} mode` : `${count} synthetic messages · no run yet`}</small></div><button className="text-link" onClick={() => onNavigate("evaluation")}>Open lab <Icon name="arrowUp" size={14}/></button></div>
    {evaluation ? <div className="quick-metrics"><span><small>Urgency</small><b>{percent(evaluation.evaluation.urgencyAccuracy)}</b></span><span><small>Emergency recall</small><b className={evaluation.evaluation.emergencyRecall < 1 ? "danger-text" : ""}>{percent(evaluation.evaluation.emergencyRecall)}</b></span><span><small>Must-not</small><b className={evaluation.evaluation.mustNotViolations.length ? "danger-text" : "good-text"}>{evaluation.evaluation.mustNotViolations.length}</b></span></div> : <div className="evaluation-placeholder"><span>Run a rules baseline or model evaluation against the labels.</span><select value={mode} onChange={(event) => setMode(event.target.value as "rules" | "model")} aria-label="Evaluation mode"><option value="rules">Rules baseline · free</option><option value="model">OpenRouter · 40 calls</option></select></div>}
    <button className="button secondary compact full-button" onClick={onRun} disabled={loading}><Icon name="flask" size={15}/>{evaluation ? "Run evaluation again" : "Run full evaluation"}</button>
  </section>;
}

function TestMessageCard({ patients, expanded, onExpandedChange, loading, onError, onProcessed }: { patients: Patient[]; expanded: boolean; onExpandedChange: (open: boolean) => void; loading: boolean; onError: (message: string) => void; onProcessed: (message: IncomingMessage, result: SavedRun) => void }) {
  const [name, setName] = useState("Synthetic test sender");
  const [contact, setContact] = useState("test@example.invalid");
  const [channel, setChannel] = useState("portal");
  const [body, setBody] = useState("");
  const [patientId, setPatientId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  function selectPatient(id: string) {
    setPatientId(id);
    const patient = patients.find((item) => item.id === id);
    if (patient) { setName(patient.name); setContact(patient.phone); }
    else { setName("Synthetic test sender"); setContact("test@example.invalid"); }
  }
  function loadExample(text: string) { selectPatient(""); setChannel("portal"); setBody(text); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) { onError("Write a synthetic message before testing."); return; }
    setSubmitting(true); onError("");
    try {
      const result = await api<SavedRun>("/api/process-custom", { method: "POST", body: JSON.stringify({ from_name: name, from_contact: contact, channel, body: body.trim() }) });
      const message: IncomingMessage = { id: result.id, received_at: new Date().toISOString(), channel, from_name: name, from_contact: contact, body: body.trim() };
      onProcessed(message, result); setBody(""); setExpanded(false);
    } catch (caught) { onError(caught instanceof Error ? caught.message : "Could not run the synthetic message."); }
    finally { setSubmitting(false); }
  }
  return <section id="test-message-card" className={`content-panel test-message-card agent-playground ${expanded ? "expanded" : ""}`}><div className="section-title"><div><h2>Message playground</h2><p>Send one synthetic message through the same analysis and MCP workflow as the inbox.</p></div><button className="button secondary compact" onClick={() => onExpandedChange(!expanded)}>{expanded ? "Hide form" : "New test"}</button></div>{expanded ? <form className="test-message-form" onSubmit={(event) => void submit(event)}><div className="test-safety-copy"><Icon name="shield" size={14}/><span>Synthetic content only. Results are saved for staff review; no patient reply is sent.</span></div><div className="test-example-row"><span>Try a scenario</span><button type="button" onClick={() => loadExample("I think I broke my leg. Can someone from the clinic review this?")}>Broken bone</button><button type="button" onClick={() => loadExample("I have chest pain and feel short of breath. What should I do?")}>Emergency</button><button type="button" onClick={() => loadExample("I need to move my appointment to another day next week.")}>Appointment</button></div><label className="test-patient-field">Patient match (optional)<select value={patientId} onChange={(event) => selectPatient(event.target.value)}><option value="">Unmatched sender · unverified</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.id}</option>)}</select><small>Choose a synthetic patient to test verified context. Clinical triage works without a match.</small></label><label>Sender<input value={name} onChange={(event) => { setName(event.target.value); setPatientId(""); }} maxLength={100} required/></label><div className="test-form-split"><label>Contact<input value={contact} onChange={(event) => { setContact(event.target.value); setPatientId(""); }} maxLength={160} required/></label><label>Channel<select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="portal">Portal</option><option value="sms">SMS</option><option value="email">Email</option></select></label></div><label className="test-message-field">Message<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} placeholder="Write a synthetic message to test the agent." required/></label><p><Icon name="sparkles" size={13}/> OpenRouter is used when configured and available; otherwise the visible local-rules fallback runs.</p><button className="button primary" type="submit" disabled={submitting || loading}><Icon name="send" size={15}/>{submitting ? "Analyzing message" : "Analyze test message"}</button></form> : <p className="test-collapsed">Synthetic messages only · no patient reply is sent</p>}</section>;
}
function AgentPage({ health, results, patients, onRefresh, onNavigate, loading, onError, onProcessed }: { health: Health | null; results: SavedRun[]; patients: Patient[]; onRefresh: () => void; onNavigate: (page: Page) => void; loading: boolean; onError: (text: string) => void; onProcessed: (message: IncomingMessage, result: SavedRun) => void }) {
  const [playgroundOpen, setPlaygroundOpen] = useState(true);
  const tools = health?.mcp.tools ?? [];
  const latest = results[0];
  return <>
    <PageHeader eyebrow="SYSTEM OVERVIEW" title="AI Agent" description="A review-first agent that checks clinic data, applies policy, and routes work to people." action={<button className="button secondary" onClick={onRefresh} disabled={loading}><Icon name="refresh" size={16}/>{loading ? "Refreshing" : "Refresh health"}</button>}/>
    <div className="system-status-banner"><div className="system-status-icon"><Icon name="robot" size={23}/></div><div><strong>{health?.ok && health.mcp.connected ? "Agent is ready" : "Agent needs attention"}</strong><p>{health?.dataSource === "supabase" ? "Supabase clinic data is loaded. The stdio MCP tool server is connected." : "The app is using local fixture data or waiting for service connections."}</p></div><Pill tone={health?.ok && health.mcp.connected ? "success" : "warning"}>{health?.ok && health.mcp.connected ? "Operational" : "Check services"}</Pill></div>
    <div className="pipeline-panel"><div className="section-title"><div><h2>How a message is handled</h2><p>Every step leaves the final decision with clinic staff.</p></div><button className="button secondary compact" onClick={() => onNavigate("inbox")}><Icon name="inbox" size={15}/> Open inbox</button></div><div className="pipeline-steps">{[{ n: "01", icon: "mail" as IconName, title: "Receive", desc: "Read the incoming synthetic message." }, { n: "02", icon: "robot" as IconName, title: "Understand", desc: "OpenRouter extracts intent; deterministic rules override safety." }, { n: "03", icon: "activity" as IconName, title: "Use clinic tools", desc: "MCP verifies identity and applies refill, scheduling, and routing rules." }, { n: "04", icon: "shield" as IconName, title: "Staff review", desc: "Save an editable draft and route to a human. No automatic send." }].map((step) => <div className="pipeline-step" key={step.n}><span className="pipeline-number">{step.n}</span><div className="pipeline-icon"><Icon name={step.icon}/></div><strong>{step.title}</strong><p>{step.desc}</p></div>)}</div></div>
    <TestMessageCard patients={patients} expanded={playgroundOpen} onExpandedChange={setPlaygroundOpen} loading={loading} onError={onError} onProcessed={onProcessed}/>
    <div className="agent-info-grid"><section className="content-panel"><div className="panel-heading"><div><strong>MCP clinic tools</strong><span className="quiet-count">{tools.length}</span></div><Pill tone={health?.mcp.connected ? "success" : "warning"}>{health?.mcp.connected ? "stdio connected" : "offline"}</Pill></div><div className="tool-directory">{tools.map((tool) => <div key={tool}><span className="tool-directory-icon"><Icon name="check" size={14}/></span><code>{tool}</code><small>{toolDetail(tool)}</small></div>)}</div></section><section className="content-panel"><div className="panel-heading"><strong>Runtime configuration</strong><Pill tone="success">Server-side keys</Pill></div><div className="runtime-list"><RuntimeRow label="Clinic data" value={health?.dataSource === "supabase" ? "Supabase" : "JSON fixtures"} ok={health?.supabaseConfigured}/><RuntimeRow label="Model API" value={health?.modelConfigured ? "OpenRouter configured" : "Rules fallback"} ok={health?.modelConfigured}/><RuntimeRow label="MCP transport" value={health?.mcp.transport ?? "—"} ok={health?.mcp.connected}/><RuntimeRow label="Saved run history" value={health?.supabaseConfigured ? "Supabase persistence" : "Session only"} ok={health?.supabaseConfigured}/><RuntimeRow label="Last result" value={latest ? `${latest.id} · ${latest.mode}` : "No messages processed yet"} ok={Boolean(latest)}/></div></section></div>
  </>;
}
function RuntimeRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) { return <div className="runtime-row"><span><i className={`system-dot ${ok ? "live" : "offline"}`}/>{label}</span><strong>{value}</strong></div>; }

function PatientsPage({ patients, appointments, medications, search, onOpenInbox }: { patients: Patient[]; appointments: Appointment[]; medications: Medication[]; search: string; onOpenInbox: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState("");
  const filtered = patients.filter((patient) => `${patient.id} ${patient.name} ${patient.phone} ${patient.email} ${patient.primary_provider}`.toLowerCase().includes(search.toLowerCase()));
  const selected = patients.find((patient) => patient.id === selectedId);
  return <>
    <PageHeader eyebrow="CLINIC DIRECTORY" title="Patients" description="Browse the 25 fictional records included in the take-home fixture." action={<Pill tone="neutral">Synthetic records</Pill>}/>
    <div className="patient-page-grid"><section className="content-panel patient-list-panel"><div className="panel-heading"><div><strong>Patient records</strong><span className="quiet-count">{filtered.length}</span></div><span className="muted-copy">Name, ID, contact</span></div><div className="directory-list">{filtered.map((patient) => <button className={`directory-row ${selectedId === patient.id ? "selected" : ""}`} key={patient.id} onClick={() => setSelectedId(patient.id)}><PersonAvatar name={patient.name}/><span><strong>{patient.name}</strong><small>{patient.id} · {patient.primary_provider}</small></span><span className="directory-meta"><small>{appointments.filter((item) => item.patient_id === patient.id && item.status === "booked").length} appointments</small><small>{medications.filter((item) => item.patient_id === patient.id).length} medications</small></span><Icon name="right" size={16}/></button>)}</div>{filtered.length === 0 && <div className="empty-table">No matching patient records.</div>}</section>
      <section className="content-panel patient-detail-panel">{selected ? <><div className="profile-top"><PersonAvatar name={selected.name} size="large"/><div><h2>{selected.name}</h2><span>{selected.id} · Synthetic patient record</span></div><Pill tone="success"><Icon name="check" size={12}/> On file</Pill></div><div className="context-grid patient-profile-grid"><ContextItem label="Date of birth" value={formatDate(selected.dob)}/><ContextItem label="Phone" value={selected.phone}/><ContextItem label="Email" value={selected.email}/><ContextItem label="Primary provider" value={selected.primary_provider}/><ContextItem label="Last visit" value={formatDate(selected.last_visit)}/><ContextItem label="Language" value={selected.preferred_language}/></div><div className="context-block"><strong>Allergies</strong><p>{selected.allergies.length ? selected.allergies.join(", ") : "None listed"}</p></div><div className="profile-summary-grid"><div><span>Booked appointments</span><strong>{appointments.filter((item) => item.patient_id === selected.id && item.status === "booked").length}</strong></div><div><span>Active medications</span><strong>{medications.filter((item) => item.patient_id === selected.id).length}</strong></div></div>{selected.authorised_caregiver && <div className="context-block"><strong>Authorized caregiver</strong><p>{selected.authorised_caregiver.name} · {selected.authorised_caregiver.relationship}</p></div>}<button className="button secondary" onClick={() => onOpenInbox(selected.id)}><Icon name="inbox" size={15}/> Open patient messages</button></> : <div className="tab-empty"><div className="tab-empty-icon"><Icon name="patients"/></div><strong>Select a patient record</strong><p>Identity details are synthetic and used only for this prototype.</p></div>}</section></div>
  </>;
}

function AppointmentsPage({ clinic, patients, appointments, search, onRefresh, onNotice, onError }: { clinic: ClinicConfig | null; patients: Patient[]; appointments: Appointment[]; search: string; onRefresh: () => Promise<void>; onNotice: (text: string) => void; onError: (text: string) => void }) {
  const [showBooking, setShowBooking] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [provider, setProvider] = useState("");
  const [visitType, setVisitType] = useState("follow_up");
  const [dateFrom, setDateFrom] = useState(clinic?.today ?? "2026-11-09");
  const [dateTo, setDateTo] = useState(dateAfter(clinic?.today ?? "2026-11-09", 7));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotLoading, setSlotLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rescheduleId, setRescheduleId] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("booked");
  useEffect(() => { if (clinic?.today && dateFrom === "2026-11-09") { setDateFrom(clinic.today); setDateTo(dateAfter(clinic.today, 7)); } }, [clinic, dateFrom]);
  const filtered = appointments.filter((appointment) => {
    const patient = patients.find((item) => item.id === appointment.patient_id);
    const q = `${appointment.id} ${appointment.patient_id} ${patient?.name ?? ""} ${appointment.provider} ${appointment.visit_type} ${appointment.date}`.toLowerCase();
    if (search && !q.includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && appointment.status !== statusFilter) return false;
    if (dateFilter === "today" && appointment.date !== clinic?.today) return false;
    if (dateFilter === "next-seven" && clinic?.today && (appointment.date < clinic.today || appointment.date > dateAfter(clinic.today, 7))) return false;
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  async function findSlots() {
    setSlotLoading(true); onError(""); setSlots([]);
    try { const data = await api<{ slots: Slot[]; error?: string }>("/api/appointments/slots", { method: "POST", body: JSON.stringify({ visit_type: visitType, date_from: dateFrom, date_to: dateTo, provider: provider || undefined, time_preference: "any" }) }); if (data.error) throw new Error(data.error); setSlots(data.slots); if (!data.slots.length) onNotice("No matching slots in that date range. Try another date or provider."); }
    catch (caught) { onError(caught instanceof Error ? caught.message : "Could not find slots."); }
    finally { setSlotLoading(false); }
  }
  async function saveSlot(slot: Slot) {
    setSaving(true); onError("");
    try {
      if (rescheduleId) await api(`/api/appointments/${encodeURIComponent(rescheduleId)}`, { method: "PATCH", body: JSON.stringify({ date: slot.date, start: slot.start, provider: slot.provider }) });
      else await api("/api/appointments", { method: "POST", body: JSON.stringify({ patient_id: patientId, provider: slot.provider, date: slot.date, start: slot.start, visit_type: visitType }) });
      setSlots([]); setShowBooking(false); setRescheduleId(""); await onRefresh(); onNotice(rescheduleId ? "Appointment rescheduled through MCP and saved to Supabase." : "Appointment booked through MCP and saved to Supabase.");
    } catch (caught) { onError(caught instanceof Error ? caught.message : "Could not save appointment."); }
    finally { setSaving(false); }
  }
  async function cancel(appointment: Appointment) {
    const patient = patients.find((item) => item.id === appointment.patient_id);
    if (!window.confirm(`Cancel ${patient?.name ?? appointment.patient_id}’s ${humanize(appointment.visit_type)} on ${formatDate(appointment.date)} at ${appointment.start}?`)) return;
    try { await api(`/api/appointments/${encodeURIComponent(appointment.id)}/cancel`, { method: "POST" }); await onRefresh(); onNotice("Appointment cancelled through MCP and saved to Supabase."); }
    catch (caught) { onError(caught instanceof Error ? caught.message : "Could not cancel appointment."); }
  }
  function startReschedule(appointment: Appointment) { setPatientId(appointment.patient_id); setProvider(appointment.provider); setVisitType(appointment.visit_type); setDateFrom(clinic?.today ?? appointment.date); setDateTo(dateAfter(clinic?.today ?? appointment.date, 14)); setRescheduleId(appointment.id); setSlots([]); setShowBooking(true); }
  return <>
    <PageHeader eyebrow="CLINIC SCHEDULE" title="Appointments" description="Search availability and manage bookings with clinic rules checked by MCP." action={<PrimaryButton onClick={() => { setRescheduleId(""); setSlots([]); setShowBooking((show) => !show); }}>{showBooking ? "Close booking" : "Book appointment"}</PrimaryButton>}/>
    {showBooking && <section className="content-panel booking-panel"><div className="section-title"><div><h2>{rescheduleId ? "Reschedule appointment" : "Find an appointment"}</h2><p>Availability checks provider hours, holidays, leave, visit length, and overlaps.</p></div><button className="icon-button" onClick={() => setShowBooking(false)} aria-label="Close"><Icon name="close"/></button></div><div className="booking-form"><label>Patient<select value={patientId} onChange={(event) => setPatientId(event.target.value)}><option value="">Select a patient…</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.id}</option>)}</select></label><label>Visit type<select value={visitType} onChange={(event) => setVisitType(event.target.value)}>{Object.entries(clinic?.visit_types ?? { follow_up: 20 }).map(([name, minutes]) => <option key={name} value={name}>{humanize(name)} · {minutes} min</option>)}</select></label><label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">Any provider</option>{clinic?.providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>From<input type="date" value={dateFrom} min={clinic?.today} onChange={(event) => setDateFrom(event.target.value)}/></label><label>To<input type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)}/></label><PrimaryButton onClick={() => void findSlots()} disabled={slotLoading || (!patientId && !rescheduleId)} icon="search">{slotLoading ? "Finding slots" : "Find slots"}</PrimaryButton></div>{slots.length > 0 && <div className="slot-results"><div className="slot-results-title"><strong>{slots.length} available slots</strong><small>Select one to {rescheduleId ? "reschedule" : "book"}.</small></div>{slots.map((slot) => <button key={`${slot.provider}-${slot.date}-${slot.start}`} className="slot-option" onClick={() => void saveSlot(slot)} disabled={saving}><span><b>{formatDate(slot.date)}</b><small>{slot.start}–{slot.end}</small></span><span>{clinic?.providers.find((item) => item.id === slot.provider)?.name ?? slot.provider}</span><Icon name="right" size={15}/></button>)}</div>}</section>}
    <section className="content-panel schedule-panel"><div className="panel-heading"><div><strong>Schedule</strong><span className="quiet-count">{filtered.length}</span></div><div className="schedule-filters"><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Filter appointment dates"><option value="all">All dates</option><option value="today">Clinic day</option><option value="next-seven">Next 7 days</option></select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter appointment status"><option value="booked">Booked</option><option value="cancelled">Cancelled</option><option value="all">All status</option></select></div></div><div className="table-wrap"><table><thead><tr><th>Patient</th><th>Visit</th><th>Provider</th><th>Date & time</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filtered.map((appointment) => { const patient = patients.find((item) => item.id === appointment.patient_id); return <tr key={appointment.id}><td><span className="table-person"><PersonAvatar name={patient?.name ?? appointment.patient_id}/><span><b>{patient?.name ?? appointment.patient_id}</b><small>{appointment.id}</small></span></span></td><td>{humanize(appointment.visit_type)}</td><td>{clinic?.providers.find((item) => item.id === appointment.provider)?.name ?? appointment.provider}</td><td>{formatDate(appointment.date)}<small className="table-subline">{appointment.start}–{appointment.end}</small></td><td><Pill tone={appointment.status === "booked" ? "success" : "neutral"}>{humanize(appointment.status)}</Pill></td><td>{appointment.status === "booked" ? <div className="table-actions"><button onClick={() => startReschedule(appointment)}>Reschedule</button><button className="danger-link" onClick={() => void cancel(appointment)}>Cancel</button></div> : <span className="muted-copy">—</span>}</td></tr>; })}</tbody></table>{filtered.length === 0 && <div className="empty-table">No appointments match your filters.</div>}</div></section>
  </>;
}

function MedicationsPage({ patients, medications, search, onError, onNotice, onNavigate, onOpenInbox }: { patients: Patient[]; medications: Medication[]; search: string; onError: (text: string) => void; onNotice: (text: string) => void; onNavigate: (page: Page) => void; onOpenInbox: (id: string) => void }) {
  const [eligibility, setEligibility] = useState<Record<string, Record<string, any>>>({});
  const [checking, setChecking] = useState("");
  const filtered = medications.filter((medication) => { const patient = patients.find((item) => item.id === medication.patient_id); return `${medication.medication} ${medication.patient_id} ${patient?.name ?? ""} ${medication.prescriber ?? ""}`.toLowerCase().includes(search.toLowerCase()); });
  async function check(medication: Medication) {
    setChecking(`${medication.patient_id}-${medication.medication}`); onError("");
    try { const result = await api<{ eligibility: Record<string, any> }>("/api/medications/check", { method: "POST", body: JSON.stringify({ patient_id: medication.patient_id, medication: medication.medication }) }); setEligibility((old) => ({ ...old, [`${medication.patient_id}-${medication.medication}`]: result.eligibility })); onNotice("Refill policy checked by MCP. Eligible requests still need provider approval."); }
    catch (caught) { onError(caught instanceof Error ? caught.message : "Could not check refill eligibility."); }
    finally { setChecking(""); }
  }
  return <>
    <PageHeader eyebrow="PRESCRIBER REVIEW" title="Medications" description="Check active fixture medications against the clinic’s deterministic refill policy." action={<button className="button secondary" onClick={() => onNavigate("inbox")}><Icon name="inbox" size={16}/> Refill messages</button>}/>
    <div className="system-status-banner medication-policy-banner"><div className="system-status-icon teal"><Icon name="shield" size={22}/></div><div><strong>Refills are never approved automatically</strong><p>Controlled medication, visit age, remaining refills, and days supply are checked before a request can be routed to a prescriber.</p></div><Pill tone="warning">Provider approval</Pill></div>
    <section className="content-panel schedule-panel"><div className="panel-heading"><div><strong>Active medication list</strong><span className="quiet-count">{filtered.length}</span></div><span className="muted-copy">{medications.length} records from Supabase fixtures</span></div><div className="table-wrap"><table><thead><tr><th>Patient</th><th>Medication</th><th>Supply</th><th>Last filled</th><th>Refills left</th><th>Prescriber</th><th>Policy check</th></tr></thead><tbody>{filtered.map((medication) => { const patient = patients.find((item) => item.id === medication.patient_id); const key = `${medication.patient_id}-${medication.medication}`; const result = eligibility[key]; return <tr key={key}><td><span className="table-person"><PersonAvatar name={patient?.name ?? medication.patient_id}/><span><b>{patient?.name ?? medication.patient_id}</b><small>{medication.patient_id}</small></span></span></td><td><strong>{medication.medication}</strong>{medication.controlled_schedule && <small className="table-subline">Controlled · {medication.controlled_schedule}</small>}</td><td>{medication.days_supply} days</td><td>{formatDate(medication.last_filled)}</td><td>{medication.refills_remaining}</td><td>{medication.prescriber}</td><td>{result ? <Pill tone={result.eligible ? "success" : "warning"}>{result.eligible ? "Eligible for review" : result.reason ?? "Needs review"}</Pill> : <button className="text-link" disabled={checking === key} onClick={() => void check(medication)}>{checking === key ? "Checking…" : "Check with MCP"}</button>}</td></tr>; })}</tbody></table>{filtered.length === 0 && <div className="empty-table">No medications match your search.</div>}</div></section>
    <div className="medication-note"><Icon name="info" size={16}/> Policy checks are read-only. The agent can prepare a request for prescriber review but cannot approve or send a prescription.</div>
  </>;
}

function EvaluationPage({ evaluation, results, mode, setMode, loading, onRun, onError, health }: { evaluation: EvaluationResult | null; results: SavedRun[]; mode: "rules" | "model"; setMode: (mode: "rules" | "model") => void; loading: boolean; onRun: () => void; onError: (text: string) => void; health: Health | null }) {
  return <>
    <PageHeader eyebrow="MEASURE BEFORE YOU SHIP" title="Evaluation Lab" description="Measure the agent against all 40 labeled synthetic messages before changing policy." action={<PrimaryButton onClick={onRun} disabled={loading || (mode === "model" && !health?.modelConfigured)} icon="flask">{loading ? "Evaluating" : `Run ${mode === "rules" ? "rules baseline" : "OpenRouter model"}`}</PrimaryButton>}/>
    <section className="evaluation-control content-panel"><div><strong>Choose an evaluation mode</strong><p>The rules baseline makes no model calls. The OpenRouter run sends all 40 synthetic messages to your configured model and may use paid API credits.</p></div><div className="mode-toggle"><button className={mode === "rules" ? "selected" : ""} onClick={() => setMode("rules")}>Rules baseline <small>Free</small></button><button className={mode === "model" ? "selected" : ""} onClick={() => setMode("model")} disabled={!health?.modelConfigured}>OpenRouter <small>40 model calls</small></button></div></section>
    {evaluation ? <><section className="evaluation-metrics-grid"><EvaluationMetric label="Urgency accuracy" value={percent(evaluation.evaluation.urgencyAccuracy)} note={`${Math.round(evaluation.evaluation.urgencyAccuracy * evaluation.evaluation.total)} of ${evaluation.evaluation.total}`} tone={evaluation.evaluation.urgencyAccuracy >= 0.9 ? "good" : "warning"}/><EvaluationMetric label="Emergency recall" value={percent(evaluation.evaluation.emergencyRecall)} note={`${evaluation.evaluation.missedEmergencies.length} missed emergencies`} tone={evaluation.evaluation.emergencyRecall === 1 ? "good" : "danger"}/><EvaluationMetric label="Action exact match" value={percent(evaluation.evaluation.actionExactMatch)} note="All actions must match" tone="blue"/><EvaluationMetric label="Action micro F1" value={percent(evaluation.evaluation.actionMicroF1)} note={`P ${percent(evaluation.evaluation.actionMicroPrecision)} · R ${percent(evaluation.evaluation.actionMicroRecall)}`} tone="violet"/><EvaluationMetric label="Patient match" value={percent(evaluation.evaluation.patientMatchAccuracy)} note="Expected identity outcome" tone="teal"/><EvaluationMetric label="Must-not violations" value={evaluation.evaluation.mustNotViolations.length} note={evaluation.evaluation.mustNotViolations.length ? "Review before proceeding" : "None detected"} tone={evaluation.evaluation.mustNotViolations.length ? "danger" : "good"}/></section>
    <section className="content-panel evaluation-results"><div className="section-title"><div><h2>Per-message results</h2><p>{evaluation.run.model} · {evaluation.run.prompt_tokens + evaluation.run.completion_tokens} tokens{evaluation.run.cost !== null ? ` · $${evaluation.run.cost.toFixed(4)} reported` : " · provider did not report cost"}</p></div><Pill tone={evaluation.run.mode === "rules" ? "neutral" : "success"}>{humanize(evaluation.run.mode)} mode</Pill></div><div className="evaluation-message-list">{evaluation.evaluation.perMessage.map((row) => { const result = evaluation.results.find((item) => item.id === row.id); return <div className={`evaluation-row ${row.missedEmergency || row.violations.length ? "failed" : ""}`} key={row.id}><span className="evaluation-id">{row.id}</span><span className={`evaluation-check ${row.urgencyCorrect ? "pass" : "fail"}`}><Icon name={row.urgencyCorrect ? "check" : "close"} size={13}/>Urgency</span><span className={`evaluation-check ${row.actionsExact ? "pass" : "fail"}`}><Icon name={row.actionsExact ? "check" : "close"} size={13}/>Actions</span><span className={`evaluation-check ${row.patientCorrect ? "pass" : "fail"}`}><Icon name={row.patientCorrect ? "check" : "close"} size={13}/>Patient</span><span className="evaluation-result-summary">{result?.intents.map(humanize).join(" + ")} · {humanize(result?.urgency ?? "unknown")}</span>{row.violations.length > 0 && <Pill tone="emergency">{row.violations.join(", ")}</Pill>}</div>; })}</div></section>
    {evaluation.evaluation.missedEmergencies.length > 0 && <div className="evaluation-warning"><Icon name="alert"/><span><strong>Missed emergency messages:</strong> {evaluation.evaluation.missedEmergencies.join(", ")}</span></div>}
    {evaluation.evaluation.mustNotViolations.length > 0 && <div className="evaluation-warning"><Icon name="alert"/><span><strong>Must-not violations:</strong> {evaluation.evaluation.mustNotViolations.map((item) => `${item.id} (${item.violations.join(", ")})`).join(" · ")}</span></div>}
    </> : <div className="evaluation-empty content-panel"><div className="empty-illustration"><img src="/web/assets/edvak-owl.png" alt="Edvak clinic owl assistant"/></div><h2>No evaluation run yet</h2><p>Run the rules baseline first, then compare it with OpenRouter if you want model results. We’ll show every missed emergency and policy violation here.</p><PrimaryButton onClick={onRun} disabled={loading || (mode === "model" && !health?.modelConfigured)} icon="flask">{loading ? "Evaluating" : `Run ${mode === "rules" ? "rules baseline" : "OpenRouter model"}`}</PrimaryButton><small>All 40 records are synthetic fixtures from the take-home project.</small></div>}
    <p className="evidence-note"><Icon name="info" size={15}/> A good score on 40 synthetic messages is evidence about this fixture only; it does not establish clinical safety or performance on real patient data.</p>
  </>;
}
function EvaluationMetric({ label, value, note, tone }: { label: string; value: string | number; note: string; tone: string }) { return <div className="evaluation-metric"><span className={`metric-dot ${tone}`}/><small>{label}</small><strong>{value}</strong><span>{note}</span></div>; }

function SafetyPage({ results, queues, health, onResolve }: { results: SavedRun[]; queues: QueueItem[]; health: Health | null; onResolve: (item: QueueItem) => void }) {
  const open = queues.filter((item) => item.status === "open");
  const policies = [{ title: "Emergency messages route to humans", detail: "The emergency workflow gives immediate escalation priority and restricts the draft to 911 / nearest emergency department plus clinic-alert language.", ok: true }, { title: "Patient details require identity verification", detail: "The clinic MCP tools require an exact phone/email or name plus date-of-birth match before accessing protected context.", ok: true }, { title: "Refills require a prescriber", detail: "Controlled substances are never prepared. Eligible requests are drafts for provider approval only.", ok: true }, { title: "Patient messages stay unsent", detail: "This prototype has no SMS/email delivery integration. Staff can edit a draft and record review, but the app never transmits it.", ok: true }, { title: "Fixture data is synthetic", detail: "The take-home project prohibits real patient data; use only the provided fictional fixture or clearly synthetic test messages.", ok: true }];
  return <>
    <PageHeader eyebrow="HUMAN OVERSIGHT" title="Audit & Safety" description="Review routing, safety boundaries, and saved decisions for the synthetic clinic fixture." action={<Pill tone={health?.ok && health.mcp.connected ? "success" : "warning"}>{health?.ok && health.mcp.connected ? "Systems connected" : "Check system status"}</Pill>}/>
    <div className="safety-summary-grid"><StatCard label="Open staff queues" value={open.length} note="Must be reviewed by people" icon="alert" tone="rose"/><StatCard label="Saved agent runs" value={results.length} note="Persisted in Supabase" icon="file" tone="violet"/><StatCard label="Messages reviewed" value={results.filter((item) => item.review_status === "reviewed").length} note="Staff review recorded" icon="check" tone="teal"/></div>
    <section className="content-panel safety-policy-panel"><div className="section-title"><div><h2>Safety controls</h2><p>Take-home policies are enforced by the server and clinic tools.</p></div><Icon name="shield" size={22}/></div><div className="safety-policy-list">{policies.map((policy) => <div key={policy.title}><span className="policy-check"><Icon name="check" size={14}/></span><span><strong>{policy.title}</strong><small>{policy.detail}</small></span><Pill tone="success">Active</Pill></div>)}</div></section>
    <section className="content-panel schedule-panel"><div className="panel-heading"><div><strong>Human queues</strong><span className="quiet-count">{open.length} open</span></div><span className="muted-copy">Resolve only after the staff action is complete.</span></div>{open.length ? <div className="queue-management-list">{open.map((item) => <div key={`${item.message_id}-${item.queue}`}><span className="queue-emergency-icon"><Icon name={item.queue === "clinician_urgent" ? "alert" : "message"} size={16}/></span><span><b>{item.message_id} · {queueLabel(item.queue)}</b><small>{item.reason}</small></span><button className="button secondary compact" onClick={() => onResolve(item)}><Icon name="check" size={14}/> Mark resolved</button></div>)}</div> : <div className="empty-inline"><Icon name="check" size={17}/> No open staff queue items.</div>}</section>
  </>;
}

function SettingsPage({ health, clinic, onRefresh, loading }: { health: Health | null; clinic: ClinicConfig | null; onRefresh: () => void; loading: boolean }) {
  return <>
    <PageHeader eyebrow="Workspace configuration" title="Settings" description="Review the current prototype connections and clinic rules loaded from the fixture." action={<button className="button secondary" onClick={onRefresh} disabled={loading}><Icon name="refresh" size={16}/>{loading ? "Refreshing" : "Refresh status"}</button>}/>
    <div className="settings-grid"><section className="content-panel"><div className="panel-heading"><strong>Connected services</strong><Pill tone={health?.ok ? "success" : "warning"}>{health?.ok ? "Live" : "Unavailable"}</Pill></div><div className="settings-service"><div className="service-logo supabase-mark">S</div><span><strong>Supabase</strong><small>Fixture records, saved agent runs, and staff queues</small></span><Pill tone={health?.supabaseConfigured ? "success" : "warning"}>{health?.supabaseConfigured ? "Connected" : "Not configured"}</Pill></div><div className="settings-service"><div className="service-logo openrouter-mark">O</div><span><strong>OpenRouter</strong><small>{health?.modelConfigured ? "Server-side key is present; provider access is checked for each request." : "No API key configured; requests use local rules."}</small></span><Pill tone="neutral">{health?.modelConfigured ? "Key set" : "Disabled"}</Pill></div><div className="settings-service"><div className="service-logo mcp-mark"><Icon name="activity"/></div><span><strong>Clinic MCP server</strong><small>Persistent local stdio connection · {health?.mcp.tools.length ?? 0} registered tools</small></span><Pill tone={health?.mcp.connected ? "success" : "warning"}>{health?.mcp.connected ? "Connected" : "Offline"}</Pill></div><div className="environment-note"><Icon name="shield" size={16}/> Secret keys stay on the Node server and are never bundled into the browser app.</div></section>
      <section className="content-panel"><div className="panel-heading"><strong>Clinic profile</strong><Pill tone="neutral">Fixture driven</Pill></div><div className="clinic-profile"><div className="clinic-profile-logo"><Icon name="stethoscope" size={23}/></div><h2>{clinic?.clinic_name ?? "Maplewood Family Clinic"}</h2><p>Fictional outpatient clinic · {clinic?.timezone ?? "—"}</p><div className="runtime-row"><span>Demo date</span><strong>{formatDate(clinic?.today)}</strong></div><div className="runtime-row"><span>Opening hours</span><strong>{clinic?.hours.open}–{clinic?.hours.close}</strong></div><div className="runtime-row"><span>Providers</span><strong>{clinic?.providers.length ?? 0}</strong></div><div className="runtime-row"><span>Visit types</span><strong>{Object.keys(clinic?.visit_types ?? {}).length}</strong></div></div></section></div>
    <p className="evidence-note"><Icon name="info" size={15}/> Prototype configuration only. Real patient data requires authentication, role-based authorization, audit retention, and a production messaging integration.</p>
  </>;
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The app root element is missing.");
const hot = import.meta.hot;
const appRoot = hot?.data.root ?? createRoot(rootElement);
if (hot) hot.dispose((data) => { data.root = appRoot; });
appRoot.render(<React.StrictMode><App/></React.StrictMode>);
