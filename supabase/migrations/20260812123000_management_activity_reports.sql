-- Relatórios gerenciais versionados das conversas em períodos definidos.
-- O resultado guarda apenas os resumos produzidos; as mensagens continuam em crm_records.
create table if not exists public.crm_management_activity_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid,
  report_id text not null,
  snapshot_hash text not null,
  schema_version text not null,
  prompt_version text not null,
  period_start date not null,
  period_end date not null,
  selected_owner_ids jsonb not null default '[]'::jsonb,
  entity_types jsonb not null default '[]'::jsonb,
  source_summary jsonb not null default '{}'::jsonb,
  analysis_model text,
  result_payload jsonb,
  status text not null default 'exported' check (status in ('exported','imported','archived')),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  imported_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  imported_by uuid references auth.users(id) on delete set null,
  unique(workspace_id, report_id),
  check (period_end >= period_start)
);

create index if not exists idx_crm_management_activity_reports_period
  on public.crm_management_activity_reports(workspace_id,period_end desc,created_at desc);

alter table public.crm_management_activity_reports enable row level security;

drop policy if exists crm_management_activity_reports_admin_select on public.crm_management_activity_reports;
create policy crm_management_activity_reports_admin_select on public.crm_management_activity_reports
  for select to authenticated using (public.crm_is_workspace_admin(workspace_id));

drop policy if exists crm_management_activity_reports_admin_insert on public.crm_management_activity_reports;
create policy crm_management_activity_reports_admin_insert on public.crm_management_activity_reports
  for insert to authenticated with check (public.crm_is_workspace_admin(workspace_id));

drop policy if exists crm_management_activity_reports_admin_update on public.crm_management_activity_reports;
create policy crm_management_activity_reports_admin_update on public.crm_management_activity_reports
  for update to authenticated using (public.crm_is_workspace_admin(workspace_id)) with check (public.crm_is_workspace_admin(workspace_id));

grant select,insert,update on public.crm_management_activity_reports to authenticated;

comment on table public.crm_management_activity_reports is
  'Relatórios administrativos das conversas por período. Não identifica o autor material de mensagens enviadas por conta compartilhada.';
