export type Urgency = "emergency" | "urgent" | "routine";
export type RouteQueue =
  | "clinician_urgent"
  | "clinician_routine"
  | "provider_refills"
  | "front_desk"
  | "billing";

export interface ClinicConfig {
  clinic_name: string;
  today: string;
  timezone: string;
  hours: {
    days: string[];
    open: string;
    close: string;
    lunch: [string, string];
  };
  holidays: string[];
  providers: Array<{
    id: string;
    name: string;
    role: string;
    languages: string[];
    leave?: string[][];
  }>;
  visit_types: Record<string, number>;
  booking_rules: string[];
  refill_policy: Record<string, unknown>;
  safety_policy: string;
  privacy_policy: string;
  routing_queues: RouteQueue[];
}

export interface Patient {
  id: string;
  name: string;
  dob: string;
  phone: string;
  email: string;
  primary_provider: string;
  last_visit: string;
  allergies: string[];
  preferred_language: string;
  authorised_caregiver?: {
    name: string;
    relationship: string;
    phone?: string;
    email?: string;
  };
}

export interface Medication {
  patient_id: string;
  medication: string;
  controlled_schedule: string | null;
  days_supply: number;
  last_filled: string;
  refills_remaining: number;
  prescriber: string;
}

export interface Appointment {
  id: string;
  patient_id: string;
  provider: string;
  date: string;
  start: string;
  end: string;
  visit_type: string;
  status: string;
}

export interface IncomingMessage {
  id: string;
  received_at: string;
  channel: "sms" | "portal" | "email" | string;
  from_name: string;
  from_contact: string;
  body: string;
  stated_dob?: string;
}

export interface ExpectedLabel {
  id: string;
  patient_id: string | null;
  intents: string[];
  accepted_urgency: Urgency[];
  expected_actions: string[];
  must_not: string[];
  trap: string;
}

export interface ClinicDataset {
  clinic: ClinicConfig;
  patients: Patient[];
  medications: Medication[];
  appointments: Appointment[];
  messages: IncomingMessage[];
  labels: ExpectedLabel[];
  dataSource: "supabase" | "json";
}

export interface MessageAnalysis {
  intents: string[];
  urgency: Urgency;
  medication: string | null;
  provider: string | null;
  visitType: string | null;
  datePreference: string | null;
  timePreference: "morning" | "afternoon" | "any" | null;
  appointmentAction: "book" | "reschedule" | "cancel" | null;
  replyLanguage: string;
  possibleEmergency: boolean;
  reasoningSummary: string;
}

export interface AgentResult {
  id: string;
  patient_id: string | null;
  matched_patient_id?: string | null;
  intents: string[];
  urgency: Urgency;
  actions: string[];
  routed_to: RouteQueue[];
  queue_reasons?: Array<{ queue: RouteQueue; reason: string }>;
  tool_calls: string[];
  reply_draft: string;
  verification: "verified" | "unverified" | "new_patient";
  model: string;
  mode: "openrouter" | "heuristic";
  persisted?: boolean;
  usage: { prompt_tokens: number; completion_tokens: number; cost: number | null };
  trace: Array<{ step: string; detail: string }>;
}

export interface RunEvaluation {
  total: number;
  urgencyAccuracy: number;
  emergencyRecall: number;
  actionExactMatch: number;
  actionMicroPrecision: number;
  actionMicroRecall: number;
  actionMicroF1: number;
  patientMatchAccuracy: number;
  mustNotViolations: Array<{ id: string; violations: string[] }>;
  missedEmergencies: string[];
  perMessage: Array<{
    id: string;
    urgencyCorrect: boolean;
    actionsExact: boolean;
    patientCorrect: boolean;
    missedEmergency: boolean;
    violations: string[];
  }>;
}
