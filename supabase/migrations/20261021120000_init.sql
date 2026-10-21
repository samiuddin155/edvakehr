create table if not exists public.clinic_config (
  config_key text primary key,
  data jsonb not null
);

create table if not exists public.patients (
  patient_id text primary key,
  name text not null,
  dob date,
  phone text,
  email text,
  primary_provider text,
  last_visit date,
  allergies jsonb not null default '[]'::jsonb,
  preferred_language text,
  authorised_caregiver jsonb,
  source_record jsonb not null
);

create table if not exists public.medications (
  patient_id text not null references public.patients(patient_id),
  medication text not null,
  controlled_schedule text,
  days_supply integer not null,
  last_filled date,
  refills_remaining integer not null,
  prescriber text,
  source_record jsonb not null,
  primary key (patient_id, medication)
);

create table if not exists public.appointments (
  appointment_id text primary key,
  patient_id text not null references public.patients(patient_id),
  provider text not null,
  appointment_date date not null,
  start_time time not null,
  end_time time not null,
  visit_type text not null,
  status text not null,
  source_record jsonb not null
);

create table if not exists public.sample_messages (
  message_id text primary key,
  received_at timestamptz not null,
  channel text not null,
  from_name text not null,
  from_contact text not null,
  body text not null,
  stated_dob date,
  source_record jsonb not null
);

create table if not exists public.evaluation_labels (
  message_id text primary key references public.sample_messages(message_id),
  patient_id text references public.patients(patient_id),
  intents text[] not null,
  accepted_urgency text[] not null,
  expected_actions text[] not null,
  must_not text[] not null default '{}',
  trap text not null default '',
  source_record jsonb not null
);

create index if not exists appointments_patient_id_idx on public.appointments(patient_id);
create index if not exists evaluation_labels_patient_id_idx on public.evaluation_labels(patient_id);

alter table public.clinic_config enable row level security;
alter table public.patients enable row level security;
alter table public.medications enable row level security;
alter table public.appointments enable row level security;
alter table public.sample_messages enable row level security;
alter table public.evaluation_labels enable row level security;

revoke all on public.clinic_config, public.patients, public.medications,
  public.appointments, public.sample_messages, public.evaluation_labels
  from anon, authenticated;
grant all on public.clinic_config, public.patients, public.medications,
  public.appointments, public.sample_messages, public.evaluation_labels
  to service_role;
