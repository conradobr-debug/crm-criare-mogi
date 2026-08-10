-- Planejamento gerencial versionado da carteira.
-- Sugestões nunca enviam mensagens nem criam eventos externos automaticamente.
create table if not exists public.crm_management_plan_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid,
  snapshot_id text not null,
  portfolio_hash text not null,
  schema_version text not null,
  prompt_version text not null,
  analysis_model text,
  portfolio_summary text,
  generated_at timestamptz,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) on delete set null,
  status text not null default 'exported' check (status in ('exported','active','superseded','archived')),
  source_payload jsonb not null default '{}'::jsonb,
  unique(workspace_id, snapshot_id)
);

create table if not exists public.crm_management_plan_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid,
  run_id uuid not null references public.crm_management_plan_runs(id) on delete cascade,
  entity_type text not null check (entity_type in ('lead','closed','partner','pending')),
  entity_id uuid not null,
  owner_id uuid references auth.users(id) on delete set null,
  priority text not null check (priority in ('critical','high','medium','low')),
  bucket text not null check (bucket in ('today','week','waiting','backlog')),
  status text not null default 'suggested' check (status in ('suggested','accepted','completed','dismissed','superseded')),
  action_key text not null,
  action text not null,
  reason text,
  suggested_message text,
  suggested_speech text,
  depends_on text,
  evidence jsonb not null default '[]'::jsonb,
  estimated_minutes integer not null default 20 check (estimated_minutes between 5 and 240),
  planned_date date,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users(id) on delete set null,
  dismissal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(run_id, action_key)
);

create index if not exists idx_crm_management_runs_workspace_status
  on public.crm_management_plan_runs(workspace_id,status,imported_at desc);
create index if not exists idx_crm_management_items_owner_agenda
  on public.crm_management_plan_items(workspace_id,owner_id,status,planned_date,priority);
create index if not exists idx_crm_management_items_entity
  on public.crm_management_plan_items(workspace_id,entity_type,entity_id,status);

alter table public.crm_management_plan_runs enable row level security;
alter table public.crm_management_plan_items enable row level security;

drop policy if exists crm_management_runs_workspace_all on public.crm_management_plan_runs;
create policy crm_management_runs_workspace_all on public.crm_management_plan_runs
  for all to authenticated
  using (public.crm_has_workspace_access(workspace_id))
  with check (public.crm_has_workspace_access(workspace_id));

drop policy if exists crm_management_items_workspace_all on public.crm_management_plan_items;
create policy crm_management_items_workspace_all on public.crm_management_plan_items
  for all to authenticated
  using (public.crm_has_workspace_access(workspace_id))
  with check (public.crm_has_workspace_access(workspace_id));

grant select,insert,update on public.crm_management_plan_runs to authenticated;
grant select,insert,update on public.crm_management_plan_items to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='crm_management_plan_items'
  ) then
    alter publication supabase_realtime add table public.crm_management_plan_items;
  end if;
end $$;

comment on table public.crm_management_plan_items is
  'Agenda sugerida por análise global. Exige confirmação humana antes de virar compromisso real.';
