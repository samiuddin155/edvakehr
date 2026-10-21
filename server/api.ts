import "dotenv/config";
import express from "express";
import cors from "cors";
import { resolve } from "node:path";
import { getDataset, loadAppointmentsFresh, isSupabaseConfigured, persistAppointment } from "./data.js";
import { evaluateDataset, messageFor } from "./evaluate.js";
import { processMessage, withMcpSession } from "./agent.js";
import { getClinicMcpClient, getClinicMcpStatus } from "./mcp-client.js";
import { getSavedAgentRun, getSavedAgentRuns, getSavedQueueItems, saveAgentRun, updateQueueItemStatus, updateSavedAgentRun } from "./run-store.js";
import type { Appointment, IncomingMessage, Patient, RouteQueue } from "./types.js";

const app = express();
app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
app.use(express.json({ limit: "32kb" }));
app.get("/api/health", async (_req, res) => {
  try { const dataset = await getDataset(); const mcp = await getClinicMcpStatus(); res.json({ ok: true, dataSource: dataset.dataSource, clinic: dataset.clinic.clinic_name, messages: dataset.messages.length, modelConfigured: Boolean(process.env.OPENROUTER_API_KEY), supabaseConfigured: isSupabaseConfigured(), mcp }); }
  catch (error) { res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Data source unavailable" }); }
});
app.get("/api/inbox", async (_req, res) => {
  try { const dataset = await getDataset(); res.json({ clinic: dataset.clinic, messages: dataset.messages }); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Data source unavailable" }); }
});
app.get("/api/runs", async (_req, res) => {
  try { res.json({ runs: await getSavedAgentRuns(), persistent: isSupabaseConfigured() }); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not read saved runs" }); }
});
app.get("/api/queues", async (_req, res) => {
  try { res.json({ items: await getSavedQueueItems(), persistent: isSupabaseConfigured() }); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not read staff queues" }); }
});
app.get("/api/patients", async (req, res) => {
  try {
    const dataset = await getDataset(); const query = String(req.query.q ?? "").trim().toLowerCase();
    const patients = query ? dataset.patients.filter((patient) => [patient.id, patient.name, patient.phone, patient.email, patient.primary_provider].some((value) => value?.toLowerCase().includes(query))) : dataset.patients;
    res.json({ patients });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not read patients" }); }
});
app.get("/api/medications", async (_req, res) => {
  try { const dataset = await getDataset(); res.json({ medications: dataset.medications, patients: dataset.patients.map(({ id, name, primary_provider }) => ({ id, name, primary_provider })) }); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not read medications" }); }
});
app.get("/api/appointments", async (_req, res) => {
  try {
    const dataset = await getDataset(); const appointments = await loadAppointmentsFresh(dataset.appointments);
    res.json({ appointments, providers: dataset.clinic.providers, visit_types: dataset.clinic.visit_types, today: dataset.clinic.today, hours: dataset.clinic.hours, persistent: isSupabaseConfigured() });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not read appointments" }); }
});

function parseToolPayload(value: unknown): Record<string, any> {
  const content = (value as { content?: Array<{ text?: string }> })?.content ?? [];
  const raw = content.map((part) => part.text ?? "").join("\n");
  try { return JSON.parse(raw) as Record<string, any>; }
  catch { throw new Error("Clinic tool returned an invalid response."); }
}
async function callClinicTool(name: string, args: Record<string, unknown> = {}) {
  const client = await getClinicMcpClient();
  const response = await client.callTool({ name, arguments: args });
  if ((response as { isError?: boolean }).isError) throw new Error(parseToolPayload(response).error ?? `Clinic tool ${name} failed.`);
  return parseToolPayload(response);
}
function staffMessage(patient?: Patient): IncomingMessage {
  const now = new Date().toISOString();
  return { id: `STAFF-${Date.now()}`, received_at: now, channel: "portal", from_name: patient?.name ?? "Front desk staff", from_contact: patient?.phone ?? "staff@maplewood.invalid", body: "Staff initiated a clinic workflow." };
}
async function bindVerifiedPatient(patientId: string, dataset: Awaited<ReturnType<typeof getDataset>>) {
  const patient = dataset.patients.find((item) => item.id === patientId);
  if (!patient) throw new Error("Patient not found.");
  const message = staffMessage(patient);
  await callClinicTool("set_current_message", { message, persist_changes: true });
  const verification = await callClinicTool("find_patient", { message_id: message.id });
  const current = verification.patient_id === patient.id && verification.verified;
  if (!current) throw new Error("MCP could not verify the selected patient using the contact on file.");
  return patient;
}
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

app.post("/api/appointments/slots", async (req, res) => {
  const { visit_type, date_from, date_to, provider, time_preference } = req.body ?? {};
  if (typeof visit_type !== "string" || !validDate(date_from) || !validDate(date_to) || date_from > date_to || (Date.parse(`${date_to}T00:00:00Z`) - Date.parse(`${date_from}T00:00:00Z`) > 60 * 86400000)) return res.status(400).json({ error: "Choose a visit type and a valid date range of at most 60 days." });
  try {
    const dataset = await getDataset();
    const data = await withMcpSession(async () => {
      const message = staffMessage();
      await callClinicTool("set_current_message", { message, persist_changes: false });
      return callClinicTool("find_appointment_slots", { visit_type, date_from, date_to, ...(typeof provider === "string" && provider ? { provider } : {}), time_preference: ["morning", "afternoon"].includes(time_preference) ? time_preference : "any", limit: 20 });
    });
    res.json(data);
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Could not find appointment slots" }); }
});

app.post("/api/appointments", async (req, res) => {
  const { patient_id, provider, date, start, visit_type } = req.body ?? {};
  if (![patient_id, provider, visit_type].every((value) => typeof value === "string") || !validDate(date) || typeof start !== "string" || !/^\d{2}:\d{2}$/.test(start)) return res.status(400).json({ error: "Choose a patient, provider, date, start time, and visit type." });
  try {
    const dataset = await getDataset();
    const outcome = await withMcpSession(async () => {
      const patient = await bindVerifiedPatient(patient_id, dataset);
      return callClinicTool("book_appointment", { patient_id: patient.id, provider, date, start, visit_type });
    });
    if (!outcome.booked) return res.status(409).json({ error: outcome.reason ?? "That appointment could not be booked." });
    await persistAppointment(outcome.appointment as Appointment);
    res.status(201).json(outcome);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not book appointment" }); }
});

app.patch("/api/appointments/:id", async (req, res) => {
  const { date, start, provider } = req.body ?? {};
  if (!validDate(date) || typeof start !== "string" || !/^\d{2}:\d{2}$/.test(start)) return res.status(400).json({ error: "Choose a valid date and start time." });
  try {
    const dataset = await getDataset(); const appointments = await loadAppointmentsFresh(dataset.appointments);
    const appointment = appointments.find((item) => item.id === req.params.id && item.status === "booked");
    if (!appointment) return res.status(404).json({ error: "Booked appointment not found." });
    const outcome = await withMcpSession(async () => {
      await bindVerifiedPatient(appointment.patient_id, dataset);
      return callClinicTool("reschedule_appointment", { patient_id: appointment.patient_id, appointment_id: appointment.id, ...(typeof provider === "string" ? { provider } : {}), date, start });
    });
    if (!outcome.rescheduled) return res.status(409).json({ error: outcome.reason ?? "That appointment could not be rescheduled." });
    await persistAppointment(outcome.appointment as Appointment);
    res.json(outcome);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not reschedule appointment" }); }
});

app.post("/api/appointments/:id/cancel", async (req, res) => {
  try {
    const dataset = await getDataset(); const appointments = await loadAppointmentsFresh(dataset.appointments);
    const appointment = appointments.find((item) => item.id === req.params.id && item.status === "booked");
    if (!appointment) return res.status(404).json({ error: "Booked appointment not found." });
    const outcome = await withMcpSession(async () => {
      await bindVerifiedPatient(appointment.patient_id, dataset);
      return callClinicTool("cancel_appointment", { patient_id: appointment.patient_id, appointment_id: appointment.id });
    });
    if (!outcome.cancelled) return res.status(409).json({ error: outcome.reason ?? "That appointment could not be cancelled." });
    await persistAppointment(outcome.appointment as Appointment);
    res.json(outcome);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not cancel appointment" }); }
});

app.post("/api/medications/check", async (req, res) => {
  const { patient_id, medication } = req.body ?? {};
  if (typeof patient_id !== "string" || typeof medication !== "string" || !medication.trim()) return res.status(400).json({ error: "Choose a patient and medication." });
  try {
    const dataset = await getDataset();
    const result = await withMcpSession(async () => {
      const patient = await bindVerifiedPatient(patient_id, dataset);
      const medications = await callClinicTool("get_patient_medications", { patient_id: patient.id });
      const eligibility = await callClinicTool("check_refill_eligibility", { patient_id: patient.id, medication });
      return { medications: medications.medications, eligibility };
    });
    res.json(result);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not check refill policy" }); }
});

app.post("/api/queues/:messageId/:queue/resolve", async (req, res) => {
  const allowed: RouteQueue[] = ["clinician_urgent", "clinician_routine", "provider_refills", "front_desk", "billing"];
  if (!allowed.includes(req.params.queue as RouteQueue)) return res.status(400).json({ error: "Unknown clinic queue." });
  try { res.json({ item: await updateQueueItemStatus(req.params.messageId, req.params.queue, "resolved") }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not resolve queue item" }); }
});

app.post("/api/runs/:id/review", async (req, res) => {
  try {
    const current = await getSavedAgentRun(req.params.id);
    if (current.delivery_status === "demo_sent") return res.status(409).json({ error: "This demo reply has already been marked sent." });
    if (typeof current.draft_updated_at !== "string" || typeof current.reply_draft !== "string" || !current.reply_draft.trim()) return res.status(409).json({ error: "Save a non-empty draft before staff review." });
    res.json({ result: await updateSavedAgentRun(req.params.id, { review_status: "reviewed", reviewed_at: new Date().toISOString() }) });
  }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not save review status" }); }
});
app.patch("/api/runs/:id/draft", async (req, res) => {
  const draft = req.body?.reply_draft;
  if (typeof draft !== "string" || draft.length > 2000) return res.status(400).json({ error: "Draft must be text under 2,000 characters." });
  try {
    const current = await getSavedAgentRun(req.params.id);
    if (current.delivery_status === "demo_sent") return res.status(409).json({ error: "A sent demo reply cannot be edited." });
    const changed = current.reply_draft !== draft;
    const firstSave = typeof current.draft_updated_at !== "string";
    const update: Record<string, unknown> = {
      reply_draft: draft,
      draft_updated_at: changed || firstSave ? new Date().toISOString() : current.draft_updated_at,
    };
    if (changed || firstSave) Object.assign(update, { review_status: null, reviewed_at: null, delivery_status: null, sent_at: null });
    res.json({ result: await updateSavedAgentRun(req.params.id, update) });
  }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not save draft" }); }
});
app.post("/api/runs/:id/send", async (req, res) => {
  try {
    const current = await getSavedAgentRun(req.params.id);
    if (current.delivery_status === "demo_sent") return res.status(409).json({ error: "This demo reply has already been marked sent." });
    if (current.review_status !== "reviewed" || typeof current.reviewed_at !== "string") return res.status(409).json({ error: "A staff member must review the saved draft before sending." });
    if (typeof current.draft_updated_at !== "string" || typeof current.reply_draft !== "string" || !current.reply_draft.trim()) return res.status(409).json({ error: "Save a non-empty draft before sending." });
    if (Date.parse(current.reviewed_at) < Date.parse(current.draft_updated_at)) return res.status(409).json({ error: "The draft changed after review. Review the latest version before sending." });
    const sentAt = new Date().toISOString();
    const result = await updateSavedAgentRun(req.params.id, { delivery_status: "demo_sent", sent_at: sentAt });
    res.json({ result, delivery: "demo_only" });
  }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not record the demo send" }); }
});
app.post("/api/process/:id", async (req, res) => {
  try {
    const dataset = await getDataset(); const message = messageFor(dataset, req.params.id);
    if (!message) return res.status(404).json({ error: "Message not found" });
    const result = await processMessage(message, dataset, { persistChanges: isSupabaseConfigured() });
    result.persisted = await saveAgentRun(result);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Could not process message" }); }
});
app.post("/api/process-custom", async (req, res) => {
  const body = req.body as Partial<IncomingMessage>;
  if (!body || typeof body.body !== "string" || body.body.length > 4000 || typeof body.from_name !== "string" || typeof body.from_contact !== "string") return res.status(400).json({ error: "Provide from_name, from_contact, and a message body under 4,000 characters." });
  try {
    const dataset = await getDataset();
    const message: IncomingMessage = { id: `LIVE-${Date.now()}`, received_at: new Date().toISOString(), channel: body.channel || "portal", from_name: body.from_name, from_contact: body.from_contact, body: body.body, stated_dob: body.stated_dob };
    const result = await processMessage(message, dataset, { persistChanges: isSupabaseConfigured() });
    result.persisted = await saveAgentRun(result);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Could not process message" }); }
});
app.get("/api/evaluate", async (_req, res) => {
  try { const dataset = await getDataset(); res.json(await evaluateDataset(dataset)); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Evaluation failed" }); }
});
app.post("/api/evaluate", async (req, res) => {
  const analysisMode = req.body?.analysisMode === "rules" ? "rules" : "model";
  try {
    const dataset = await getDataset(); const output = await evaluateDataset(dataset, dataset.messages, { analysisMode });
    if (req.body?.persist !== false) for (const result of output.results) result.persisted = await saveAgentRun(result);
    res.json(output);
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Evaluation failed" }); }
});
app.use(express.static(resolve(process.cwd(), "dist")));
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) return res.sendFile(resolve(process.cwd(), "dist/index.html"));
  return next();
});
const port = Number(process.env.PORT || 4317);
const httpServer = app.listen(port, "127.0.0.1", () => console.log(`Edvak front desk API listening on http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  httpServer.close();
  void import("./mcp-client.js").then(({ closeClinicMcpClient }) => closeClinicMcpClient()).finally(() => process.exit(0));
});
