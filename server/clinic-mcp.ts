import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Appointment, ClinicDataset, IncomingMessage, RouteQueue } from "./types.js";
import { loadAppointmentsFresh, persistAppointment } from "./data.js";

export interface ToolState {
  message: IncomingMessage | null;
  verifiedPatientId: string | null;
  verification: "verified" | "unverified" | "new_patient";
  appointments: Appointment[];
  routes: Array<{ queue: RouteQueue; reason: string }>;
  replyDraft: string;
  persistChanges: boolean;
}

export function newToolState(dataset: ClinicDataset): ToolState {
  return {
    message: null,
    verifiedPatientId: null,
    verification: "unverified",
    appointments: dataset.appointments.map((appointment) => ({ ...appointment })),
    routes: [],
    replyDraft: "",
    persistChanges: false,
  };
}

function text(value: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: value }] };
}

function result(value: unknown) {
  return text(JSON.stringify(value));
}

function normalizeContact(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.includes("@")) return trimmed;
  return trimmed.replace(/\D/g, "");
}

function normalizeWords(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const medicationAliases: Record<string, string[]> = {
  metformin: ["metformina"],
  alprazolam: ["xanax"],
  acetaminophen: ["tylenol"],
  albuterol: ["ventolin", "proair"],
  atorvastatin: ["lipitor"],
  levothyroxine: ["synthroid"],
  omeprazole: ["prilosec"],
  sertraline: ["zoloft"],
  zolpidem: ["ambien"],
};

function medicationMatches(record: string, requested: string): boolean {
  const row = normalizeWords(record);
  const query = normalizeWords(requested);
  if (!query) return false;
  if (row.includes(query) || query.includes(row)) return true;
  return Object.entries(medicationAliases).some(([generic, aliases]) => {
    const rowHasGeneric = row.includes(generic);
    const rowHasAlias = aliases.some((alias) => row.includes(alias));
    const queryHasGeneric = query.includes(generic);
    const queryHasAlias = aliases.some((alias) => query.includes(alias));
    return (rowHasGeneric || rowHasAlias) && (queryHasGeneric || queryHasAlias);
  });
}

function dateValue(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function addDays(value: string, days: number): string {
  const date = dateValue(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function twelveMonthsBefore(today: string): string {
  const date = dateValue(today);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function minutes(time: string): number {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
}

function timeString(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  return minutes(startA) < minutes(endB) && minutes(startB) < minutes(endA);
}

function providerOnLeave(dataset: ClinicDataset, providerId: string, date: string): boolean {
  const provider = dataset.clinic.providers.find((item) => item.id === providerId);
  return Boolean(provider?.leave?.some(([start, end]) => start <= date && date <= end));
}

function withinHours(dataset: ClinicDataset, date: string, start: string, end: string): boolean {
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dateValue(date).getUTCDay()];
  if (!dataset.clinic.hours.days.includes(day) || dataset.clinic.holidays.includes(date)) return false;
  if (minutes(start) < minutes(dataset.clinic.hours.open) || minutes(end) > minutes(dataset.clinic.hours.close)) return false;
  const [lunchStart, lunchEnd] = dataset.clinic.hours.lunch;
  return !overlaps(start, end, lunchStart, lunchEnd);
}

function validSlot(
  dataset: ClinicDataset,
  state: ToolState,
  provider: string,
  date: string,
  start: string,
  visitType: string,
  ignoreAppointmentId?: string,
): { ok: boolean; end: string; reason?: string } {
  const duration = dataset.clinic.visit_types[visitType];
  if (!duration) return { ok: false, end: "", reason: "Unknown visit type." };
  if (!dataset.clinic.providers.some((item) => item.id === provider)) return { ok: false, end: "", reason: "Unknown provider." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, end: "", reason: "Date must be YYYY-MM-DD." };
  if (!/^\d{2}:\d{2}$/.test(start)) return { ok: false, end: "", reason: "Start time must be HH:MM." };
  const startMinutes = minutes(start);
  if (![0, 20, 40].includes(startMinutes % 60)) return { ok: false, end: "", reason: "Appointments must start on the hour, :20, or :40." };
  const end = timeString(startMinutes + duration);
  if (date < dataset.clinic.today) return { ok: false, end, reason: "Cannot book in the past." };
  const receivedAt = state.message?.received_at;
  const receivedDate = receivedAt?.slice(0, 10);
  const receivedTime = receivedAt?.match(/T(\d{2}:\d{2})/)?.[1];
  if (date === receivedDate && receivedTime && minutes(start) <= minutes(receivedTime)) return { ok: false, end, reason: "That time has already passed for this message." };
  if (!withinHours(dataset, date, start, end)) return { ok: false, end, reason: "Outside clinic hours, lunch, or a holiday." };
  if (providerOnLeave(dataset, provider, date)) return { ok: false, end, reason: "Provider is on leave that day." };
  const busy = state.appointments.some(
    (appointment) =>
      appointment.id !== ignoreAppointmentId &&
      appointment.status === "booked" &&
      appointment.provider === provider &&
      appointment.date === date &&
      overlaps(start, end, appointment.start, appointment.end),
  );
  if (busy) return { ok: false, end, reason: "That provider already has an overlapping appointment." };
  return { ok: true, end };
}

export function createClinicMcpServer(dataset: ClinicDataset, state: ToolState): McpServer {
  const server = new McpServer({ name: "edvak-clinic-tools", version: "1.0.0" });

  server.registerTool(
    "set_current_message",
    {
      description: "Internal setup call: bind the incoming message before using patient lookup or workflow tools.",
      inputSchema: {
        message: z.object({
          id: z.string(),
          received_at: z.string(),
          channel: z.string(),
          from_name: z.string(),
          from_contact: z.string(),
          body: z.string(),
          stated_dob: z.string().optional(),
        }),
        persist_changes: z.boolean().optional(),
      },
    },
    async ({ message, persist_changes = false }) => {
      state.message = message;
      state.verifiedPatientId = null;
      state.verification = "unverified";
      state.persistChanges = persist_changes;
      state.appointments = persist_changes ? await loadAppointmentsFresh(dataset.appointments) : dataset.appointments.map((appointment) => ({ ...appointment }));
      state.routes = [];
      state.replyDraft = "";
      return result({ ready: true, message_id: message.id });
    },
  );

  server.registerTool(
    "find_patient",
    {
      title: "Find and verify patient",
      description: "Match the bound sender to a patient or authorized caregiver. Uses exact contact or name plus date of birth; never guess from a similar name.",
      inputSchema: { message_id: z.string() },
    },
    async ({ message_id }) => {
      const message = state.message;
      if (!message || message.id !== message_id) return result({ patient_id: null, verified: false, reason: "No matching active message." });
      const contact = normalizeContact(message.from_contact);
      const senderName = normalizeWords(message.from_name);
      for (const patient of dataset.patients) {
        const patientName = normalizeWords(patient.name);
        const contactMatch = [patient.phone, patient.email].some((value) => value && normalizeContact(value) === contact);
        const nameDobMatch = senderName === patientName && Boolean(message.stated_dob) && message.stated_dob === patient.dob;
        const caregiver = patient.authorised_caregiver;
        const caregiverMatch = Boolean(
          caregiver &&
            normalizeWords(caregiver.name) === senderName &&
            [caregiver.phone, caregiver.email].some((value) => value && normalizeContact(value) === contact),
        );
        if (contactMatch || nameDobMatch || caregiverMatch) {
          state.verifiedPatientId = patient.id;
          state.verification = "verified";
          return result({ patient_id: patient.id, verified: true, verified_as: caregiverMatch ? "authorized_caregiver" : "patient" });
        }
      }
      const nameCandidates = dataset.patients.filter((patient) =>
        normalizeWords(patient.name) === senderName || normalizeWords(message.body).includes(normalizeWords(patient.name)),
      );
      state.verifiedPatientId = null;
      state.verification = "unverified";
      return result({ patient_id: null, candidate_id: nameCandidates.length === 1 ? nameCandidates[0].id : null, verified: false, reason: "No exact contact or name plus date-of-birth match." });
    },
  );

  server.registerTool(
    "get_patient_medications",
    {
      title: "Read patient medications",
      description: "Return a verified patient's active medications. Requires a prior successful find_patient call for this message.",
      inputSchema: { patient_id: z.string() },
    },
    async ({ patient_id }) => {
      if (state.verifiedPatientId !== patient_id) return result({ error: "Patient verification required." });
      const medications = dataset.medications.filter((medication) => medication.patient_id === patient_id);
      return result({ medications });
    },
  );

  server.registerTool(
    "check_refill_eligibility",
    {
      title: "Check refill policy",
      description: "Apply the clinic's deterministic refill policy. This can prepare a request for provider approval; it never approves or sends a prescription.",
      inputSchema: { patient_id: z.string(), medication: z.string() },
    },
    async ({ patient_id, medication: requestedMedication }) => {
      if (state.verifiedPatientId !== patient_id) return result({ eligible: false, reason: "Patient verification required." });
      const med = dataset.medications.find(
        (item) => item.patient_id === patient_id && medicationMatches(item.medication, requestedMedication),
      );
      if (!med) return result({ eligible: false, reason: "Medication is not on the patient's active list." });
      if (med.controlled_schedule) return result({ eligible: false, reason: "Controlled substance; route to prescribing provider.", medication: med.medication, controlled: true });
      const patient = dataset.patients.find((item) => item.id === patient_id);
      const lastSeenLimit = twelveMonthsBefore(dataset.clinic.today);
      if (!patient || patient.last_visit < lastSeenLimit) {
        return result({ eligible: false, reason: "Patient has not been seen in the last 12 months.", medication: med.medication, needs_visit: true });
      }
      if (med.refills_remaining <= 0) return result({ eligible: false, reason: "No refills remain; provider must issue a new prescription.", medication: med.medication, no_refills: true });
      const supplyEnds = addDays(med.last_filled, med.days_supply);
      const earliestRequest = addDays(supplyEnds, -7);
      if (dataset.clinic.today < earliestRequest) {
        return result({ eligible: false, reason: "Request is too early.", medication: med.medication, earliest_request_date: earliestRequest, supply_ends: supplyEnds, too_early: true });
      }
      return result({ eligible: true, reason: "Eligible to prepare for provider approval.", medication: med.medication, refills_remaining: med.refills_remaining });
    },
  );

  server.registerTool(
    "get_patient_appointments",
    {
      title: "Find patient appointments",
      description: "List a verified patient's booked appointments, needed before a cancellation or reschedule.",
      inputSchema: { patient_id: z.string() },
    },
    async ({ patient_id }) => {
      if (state.verifiedPatientId !== patient_id) return result({ error: "Patient verification required." });
      return result({ appointments: state.appointments.filter((appointment) => appointment.patient_id === patient_id && appointment.status === "booked") });
    },
  );

  server.registerTool(
    "find_appointment_slots",
    {
      title: "Find appointment slots",
      description: "Return available slots that satisfy hours, holidays, provider leave, visit duration, and overlap rules.",
      inputSchema: {
        visit_type: z.string(),
        date_from: z.string(),
        date_to: z.string(),
        provider: z.string().optional(),
        time_preference: z.enum(["morning", "afternoon", "any"]).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ visit_type, date_from, date_to, provider, time_preference = "any", limit = 8 }) => {
      const candidates: Appointment[] = [];
      const duration = dataset.clinic.visit_types[visit_type];
      if (!duration) return result({ slots: [], error: "Unknown visit type." });
      const endDate = dateValue(date_to);
      for (let cursor = dateValue(date_from); cursor <= endDate && candidates.length < limit * 6; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const date = cursor.toISOString().slice(0, 10);
        const dayProviders = provider ? [provider] : dataset.clinic.providers.map((item) => item.id);
        for (const providerId of dayProviders) {
          for (let start = minutes(dataset.clinic.hours.open); start < minutes(dataset.clinic.hours.close); start += 20) {
            if (start % 60 !== 0 && start % 60 !== 20 && start % 60 !== 40) continue;
            const startTime = timeString(start);
            if (time_preference === "morning" && start >= 12 * 60) continue;
            if (time_preference === "afternoon" && start < 13 * 60) continue;
            const validity = validSlot(dataset, state, providerId, date, startTime, visit_type);
            if (!validity.ok) continue;
            candidates.push({
              id: `OFFER-${providerId}-${date}-${startTime}`,
              patient_id: "",
              provider: providerId,
              date,
              start: startTime,
              end: validity.end,
              visit_type,
              status: "available",
            });
          }
        }
      }
      candidates.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
      return result({ slots: candidates.slice(0, limit) });
    },
  );

  server.registerTool(
    "book_appointment",
    {
      title: "Book appointment",
      description: "Create a booking only for a verified patient and only when all clinic scheduling rules pass.",
      inputSchema: { patient_id: z.string(), provider: z.string(), date: z.string(), start: z.string(), visit_type: z.string() },
    },
    async ({ patient_id, provider, date, start, visit_type }) => {
      if (state.verifiedPatientId !== patient_id) return result({ booked: false, reason: "Patient verification required." });
      const slot = validSlot(dataset, state, provider, date, start, visit_type);
      if (!slot.ok) return result({ booked: false, reason: slot.reason });
      const appointment: Appointment = {
        id: `RUN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        patient_id,
        provider,
        date,
        start,
        end: slot.end,
        visit_type,
        status: "booked",
      };
      if (state.persistChanges) await persistAppointment(appointment);
      state.appointments.push(appointment);
      return result({ booked: true, appointment });
    },
  );

  server.registerTool(
    "reschedule_appointment",
    {
      title: "Reschedule appointment",
      description: "Move a verified patient's existing booking to a free slot, preserving its visit type.",
      inputSchema: { patient_id: z.string(), appointment_id: z.string(), provider: z.string().optional(), date: z.string(), start: z.string() },
    },
    async ({ patient_id, appointment_id, provider, date, start }) => {
      if (state.verifiedPatientId !== patient_id) return result({ rescheduled: false, reason: "Patient verification required." });
      const appointment = state.appointments.find((item) => item.id === appointment_id && item.patient_id === patient_id && item.status === "booked");
      if (!appointment) return result({ rescheduled: false, reason: "No matching booked appointment." });
      const newProvider = provider ?? appointment.provider;
      const slot = validSlot(dataset, state, newProvider, date, start, appointment.visit_type, appointment.id);
      if (!slot.ok) return result({ rescheduled: false, reason: slot.reason });
      const previous = { ...appointment };
      Object.assign(appointment, { provider: newProvider, date, start, end: slot.end });
      try { if (state.persistChanges) await persistAppointment(appointment); }
      catch (error) { Object.assign(appointment, previous); return result({ rescheduled: false, reason: error instanceof Error ? error.message : "Could not persist appointment change." }); }
      return result({ rescheduled: true, appointment });
    },
  );

  server.registerTool(
    "cancel_appointment",
    {
      title: "Cancel appointment",
      description: "Cancel a verified patient's existing booked appointment.",
      inputSchema: { patient_id: z.string(), appointment_id: z.string() },
    },
    async ({ patient_id, appointment_id }) => {
      if (state.verifiedPatientId !== patient_id) return result({ cancelled: false, reason: "Patient verification required." });
      const appointment = state.appointments.find((item) => item.id === appointment_id && item.patient_id === patient_id && item.status === "booked");
      if (!appointment) return result({ cancelled: false, reason: "No matching booked appointment." });
      appointment.status = "cancelled";
      try { if (state.persistChanges) await persistAppointment(appointment); }
      catch (error) { appointment.status = "booked"; return result({ cancelled: false, reason: error instanceof Error ? error.message : "Could not persist cancellation." }); }
      return result({ cancelled: true, appointment });
    },
  );

  server.registerTool(
    "route_message",
    {
      title: "Route message to human queue",
      description: "Place this message in one of the clinic's human queues. Valid queues: clinician_urgent, clinician_routine, provider_refills, front_desk, billing.",
      inputSchema: { message_id: z.string(), queue: z.enum(["clinician_urgent", "clinician_routine", "provider_refills", "front_desk", "billing"]), reason: z.string() },
    },
    async ({ message_id, queue, reason }) => {
      if (!state.message || state.message.id !== message_id) return result({ routed: false, reason: "No matching active message." });
      if (!dataset.clinic.routing_queues.includes(queue as RouteQueue)) return result({ routed: false, reason: "Queue is not configured." });
      if (!state.routes.some((route) => route.queue === queue)) state.routes.push({ queue, reason });
      return result({ routed: true, queue });
    },
  );

  server.registerTool(
    "draft_reply",
    {
      title: "Draft patient reply",
      description: "Save a reply draft. Emergency drafts must tell the sender to call 911 or go to the nearest emergency department and say the clinic has been alerted; no clinical advice is allowed.",
      inputSchema: { message_id: z.string(), reply: z.string(), emergency: z.boolean().optional() },
    },
    async ({ message_id, reply, emergency = false }) => {
      if (!state.message || state.message.id !== message_id) return result({ drafted: false, reason: "No matching active message." });
      if (emergency && (!/911/i.test(reply) || !/alerted/i.test(reply))) {
        return result({ drafted: false, reason: "Emergency reply must mention 911 and that the clinic has been alerted." });
      }
      state.replyDraft = reply;
      return result({ drafted: true });
    },
  );

  return server;
}
