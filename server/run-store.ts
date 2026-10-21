import { createClient } from "@supabase/supabase-js";
import type { AgentResult } from "./types.js";
import { isSupabaseConfigured } from "./data.js";

function admin() {
  const url = process.env.SUPABASE_URL!;
  const key = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function saveAgentRun(result: AgentResult): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = admin();
  const { error } = await supabase.from("agent_runs").upsert({ message_id: result.id, payload: { ...result, persisted: true }, processed_at: new Date().toISOString() }, { onConflict: "message_id" });
  if (error) throw new Error(`Could not save agent result: ${error.message}`);
  const { error: deleteError } = await supabase.from("agent_queue_items").delete().eq("message_id", result.id);
  if (deleteError) throw new Error(`Could not replace saved queue items: ${deleteError.message}`);
  if (result.queue_reasons?.length) {
    const { error: queueError } = await supabase.from("agent_queue_items").upsert(
      result.queue_reasons.map((item) => ({ message_id: result.id, queue: item.queue, reason: item.reason, status: "open" })),
      { onConflict: "message_id,queue" },
    );
    if (queueError) throw new Error(`Agent result saved, but queue persistence failed: ${queueError.message}`);
  }
  return true;
}

export async function getSavedQueueItems() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await admin().from("agent_queue_items").select("message_id,queue,reason,status,created_at").order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(`Could not read staff queues: ${error.message}`);
  return data ?? [];
}

export async function getSavedAgentRuns(): Promise<AgentResult[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await admin().from("agent_runs").select("payload").order("processed_at", { ascending: false }).limit(100);
  if (error) throw new Error(`Could not read saved agent results: ${error.message}`);
  return (data ?? []).map((row) => row.payload as AgentResult);
}
