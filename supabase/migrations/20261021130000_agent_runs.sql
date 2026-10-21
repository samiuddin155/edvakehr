create table if not exists public.agent_runs (
  message_id text primary key,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

create table if not exists public.agent_queue_items (
  message_id text not null references public.agent_runs(message_id) on delete cascade,
  queue text not null check (queue in ('clinician_urgent', 'clinician_routine', 'provider_refills', 'front_desk', 'billing')),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  primary key (message_id, queue)
);

create index if not exists agent_runs_processed_at_idx on public.agent_runs(processed_at desc);
create index if not exists agent_queue_items_open_idx on public.agent_queue_items(queue, created_at desc) where status = 'open';

alter table public.agent_runs enable row level security;
alter table public.agent_queue_items enable row level security;

revoke all on public.agent_runs, public.agent_queue_items from anon, authenticated;
grant all on public.agent_runs, public.agent_queue_items to service_role;
