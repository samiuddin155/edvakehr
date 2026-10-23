import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.");
const db = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
async function read<T>(file: string) { return JSON.parse(await readFile(resolve(process.cwd(), "edvak_forge_data", file), "utf8")) as T; }
async function upsert(table: string, rows: object[], onConflict?: string) {
  const { error } = await db.from(table).upsert(rows as never[], onConflict ? { onConflict } : undefined);
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`${table}: ${rows.length} rows upserted`);
}
const clinic = await read<Record<string, unknown>>("clinic.json");
const patients = await read<Array<Record<string, any>>>("patients.json");
const medications = await read<Array<Record<string, any>>>("medications.json");
const appointments = await read<Array<Record<string, any>>>("appointments.json");
const messages = [
  ...await read<Array<Record<string, any>>>("messages_sample.json"),
  ...await read<Array<Record<string, any>>>("adversarial_messages.json"),
];
const labels = await read<Array<Record<string, any>>>("labels_sample.json");
await upsert("clinic_config", [{ config_key: "maplewood", data: clinic }], "config_key");
await upsert("patients", patients.map((p) => ({ patient_id: p.id, name: p.name, dob: p.dob, phone: p.phone, email: p.email, primary_provider: p.primary_provider, last_visit: p.last_visit, allergies: p.allergies, preferred_language: p.preferred_language, authorised_caregiver: p.authorised_caregiver ?? null, source_record: p })), "patient_id");
await upsert("medications", medications.map((m) => ({ patient_id: m.patient_id, medication: m.medication, controlled_schedule: m.controlled_schedule, days_supply: m.days_supply, last_filled: m.last_filled, refills_remaining: m.refills_remaining, prescriber: m.prescriber, source_record: m })), "patient_id,medication");
await upsert("appointments", appointments.map((a) => ({ appointment_id: a.id, patient_id: a.patient_id, provider: a.provider, appointment_date: a.date, start_time: a.start, end_time: a.end, visit_type: a.visit_type, status: a.status, source_record: a })), "appointment_id");
await upsert("sample_messages", messages.map((m) => ({ message_id: m.id, received_at: m.received_at, channel: m.channel, from_name: m.from_name, from_contact: m.from_contact, body: m.body, stated_dob: m.stated_dob ?? null, source_record: m })), "message_id");
await upsert("evaluation_labels", labels.map((l) => ({ message_id: l.id, patient_id: l.patient_id, intents: l.intents, accepted_urgency: l.accepted_urgency, expected_actions: l.expected_actions, must_not: l.must_not, trap: l.trap, source_record: l })), "message_id");
