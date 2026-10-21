import "dotenv/config";
import express from "express";
import cors from "cors";
import { resolve } from "node:path";
import { getDataset } from "./data.js";
import { evaluateDataset, messageFor } from "./evaluate.js";
import { processMessage } from "./agent.js";
import { getClinicMcpStatus } from "./mcp-client.js";
import { getSavedAgentRuns, getSavedQueueItems, saveAgentRun } from "./run-store.js";
import { isSupabaseConfigured } from "./data.js";
import type { IncomingMessage } from "./types.js";

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
