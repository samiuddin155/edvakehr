import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type {
  Appointment,
  ClinicConfig,
  ClinicDataset,
  ExpectedLabel,
  IncomingMessage,
  Medication,
  Patient,
} from "./types.js";

let cachedDataset: Promise<ClinicDataset> | undefined;
const localAppointmentsPath = resolve(process.cwd(), ".runtime", "appointments.json");

async function readFixture<T>(name: string): Promise<T> {
  const path = resolve(process.cwd(), "edvak_forge_data", name);
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function loadJsonDataset(): Promise<ClinicDataset> {
  const [clinic, patients, medications, appointments, messages, labels] = await Promise.all([
    readFixture<ClinicConfig>("clinic.json"),
    readFixture<Patient[]>("patients.json"),
    readFixture<Medication[]>("medications.json"),
    readFixture<Appointment[]>("appointments.json"),
    readFixture<IncomingMessage[]>("messages_sample.json"),
    readFixture<ExpectedLabel[]>("labels_sample.json"),
  ]);
  return { clinic, patients, medications, appointments, messages, labels, dataSource: "json" };
}

function required<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`Supabase returned no ${name} row.`);
  return value;
}

async function loadSupabaseDataset(): Promise<ClinicDataset> {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new Error("Set both SUPABASE_URL and SUPABASE_SECRET_KEY.");

  const supabase = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [configResult, patientsResult, medicationsResult, appointmentsResult, messagesResult, labelsResult] =
    await Promise.all([
      supabase.from("clinic_config").select("data").eq("config_key", "maplewood").single(),
      supabase.from("patients").select("source_record").order("patient_id"),
      supabase.from("medications").select("source_record").order("patient_id"),
      supabase.from("appointments").select("source_record").order("appointment_date").order("start_time"),
      supabase.from("sample_messages").select("source_record").order("received_at"),
      supabase.from("evaluation_labels").select("source_record").order("message_id"),
    ]);
  const results = [configResult, patientsResult, medicationsResult, appointmentsResult, messagesResult, labelsResult];
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`Supabase read failed: ${failed.error.message}`);

  const clinic = required(configResult.data?.data as ClinicConfig | undefined ?? null, "clinic configuration");
  const records = <T>(rows: Array<{ source_record: T }> | null): T[] => (rows ?? []).map((row) => row.source_record);
  const dataset: ClinicDataset = {
    clinic,
    patients: records(patientsResult.data) as Patient[],
    medications: records(medicationsResult.data) as Medication[],
    appointments: records(appointmentsResult.data) as Appointment[],
    messages: records(messagesResult.data) as IncomingMessage[],
    labels: records(labelsResult.data) as ExpectedLabel[],
    dataSource: "supabase",
  };
  const messageIds = new Set(dataset.messages.map((message) => message.id));
  if (dataset.patients.length !== 25 || dataset.labels.length !== 40 || dataset.labels.some((label) => !messageIds.has(label.id))) {
    throw new Error("Supabase is missing required take-home patients, labels, or labeled messages. Extra test messages are allowed.");
  }
  return dataset;
}

export function getDataset(refresh = false): Promise<ClinicDataset> {
  if (refresh) resetDatasetCache();
  if (!cachedDataset) {
    const useSupabase = isSupabaseConfigured();
    cachedDataset = (useSupabase ? loadSupabaseDataset() : loadJsonDataset()).catch((error) => {
      cachedDataset = undefined;
      throw error;
    });
  }
  return cachedDataset;
}

export function resetDatasetCache(): void {
  cachedDataset = undefined;
}

function createAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
}

export async function loadAppointmentsFresh(fallback: Appointment[]): Promise<Appointment[]> {
  const supabase = createAdminClient();
  if (!supabase) {
    let saved: Appointment[] = [];
    try { saved = JSON.parse(await readFile(localAppointmentsPath, "utf8")) as Appointment[]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const byId = new Map(fallback.map((appointment) => [appointment.id, { ...appointment }]));
    for (const appointment of saved) byId.set(appointment.id, appointment);
    return [...byId.values()];
  }
  const { data, error } = await supabase.from("appointments").select("source_record").order("appointment_date").order("start_time");
  if (error) throw new Error(`Could not refresh appointments from Supabase: ${error.message}`);
  return (data ?? []).map((row) => row.source_record as Appointment);
}

export async function persistAppointment(appointment: Appointment): Promise<void> {
  const supabase = createAdminClient();
  if (!supabase) {
    const appointments = await loadAppointmentsFresh((await getDataset()).appointments);
    const byId = new Map(appointments.map((item) => [item.id, item]));
    byId.set(appointment.id, appointment);
    await mkdir(resolve(process.cwd(), ".runtime"), { recursive: true });
    const temporaryPath = `${localAppointmentsPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify([...byId.values()], null, 2)}\n`, "utf8");
    await rename(temporaryPath, localAppointmentsPath);
    return;
  }
  const { error } = await supabase.from("appointments").upsert({
    appointment_id: appointment.id,
    patient_id: appointment.patient_id,
    provider: appointment.provider,
    appointment_date: appointment.date,
    start_time: appointment.start,
    end_time: appointment.end,
    visit_type: appointment.visit_type,
    status: appointment.status,
    source_record: appointment,
  }, { onConflict: "appointment_id" });
  if (error) throw new Error(`Supabase appointment write failed: ${error.message}`);
}
