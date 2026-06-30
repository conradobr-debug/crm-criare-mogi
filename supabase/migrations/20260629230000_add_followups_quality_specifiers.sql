-- Acompanhamento comercial, qualidade de lead e especificadores.
-- Migração aditiva e idempotente: não remove nem recria dados existentes.

alter table public.crm_records
  add column if not exists record_type text not null default 'lead',
  add column if not exists specifier_type text null,
  add column if not exists company_name text null,
  add column if not exists next_action_at timestamptz null,
  add column if not exists next_action_kind text null,
  add column if not exists last_contact_at timestamptz null,
  add column if not exists lead_quality text not null default 'Não avaliado',
  add column if not exists quality_notes text null;

update public.crm_records
set record_type = 'lead'
where record_type is null;

update public.crm_records
set next_action_at = next_action::timestamp at time zone 'America/Sao_Paulo'
where next_action is not null
  and next_action_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_records_record_type_check'
      and conrelid = 'public.crm_records'::regclass
  ) then
    alter table public.crm_records
      add constraint crm_records_record_type_check
      check (record_type in ('lead', 'specifier'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_records_lead_quality_check'
      and conrelid = 'public.crm_records'::regclass
  ) then
    alter table public.crm_records
      add constraint crm_records_lead_quality_check
      check (lead_quality in ('Não avaliado', 'Perfil Criare', 'Potencial', 'Baixo potencial', 'Fora do perfil'));
  end if;
end
$$;

create index if not exists idx_crm_records_record_type
  on public.crm_records (record_type);

create index if not exists idx_crm_records_next_action_at
  on public.crm_records (next_action_at);

create index if not exists idx_crm_records_last_contact_at
  on public.crm_records (last_contact_at);

create index if not exists idx_crm_records_lead_quality
  on public.crm_records (lead_quality);

create table if not exists public.crm_record_events (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.crm_records(id) on delete cascade,
  event_type text not null,
  actor_id uuid null references public.crm_profiles(id) on delete set null,
  from_value text null,
  to_value text null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_crm_record_events_record_time
  on public.crm_record_events (record_id, occurred_at desc);

create index if not exists idx_crm_record_events_type_time
  on public.crm_record_events (event_type, occurred_at desc);

alter table public.crm_record_events enable row level security;

grant select on public.crm_record_events to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'crm_record_events'
      and policyname = 'crm_record_events_authenticated_select'
  ) then
    create policy crm_record_events_authenticated_select
      on public.crm_record_events
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.crm_records r
          where r.id = crm_record_events.record_id
        )
      );
  end if;
end
$$;

create or replace function public.log_crm_record_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_record_events(record_id, event_type, actor_id, to_value)
    values (new.id, 'created', auth.uid(), coalesce(new.stage, ''));
    return new;
  end if;

  if old.stage is distinct from new.stage
     or old.pipeline is distinct from new.pipeline
     or old.record_type is distinct from new.record_type then
    insert into public.crm_record_events(record_id, event_type, actor_id, from_value, to_value)
    values (
      new.id,
      'stage_changed',
      auth.uid(),
      concat_ws(' / ', old.pipeline, old.stage),
      concat_ws(' / ', new.pipeline, new.stage)
    );
  end if;

  if old.next_action_at is distinct from new.next_action_at
     or old.next_action is distinct from new.next_action then
    insert into public.crm_record_events(record_id, event_type, actor_id, from_value, to_value, metadata)
    values (
      new.id,
      'followup_scheduled',
      auth.uid(),
      coalesce(old.next_action_at::text, old.next_action::text),
      coalesce(new.next_action_at::text, new.next_action::text),
      jsonb_build_object('kind', new.next_action_kind)
    );
  end if;

  if old.last_contact_at is distinct from new.last_contact_at then
    insert into public.crm_record_events(record_id, event_type, actor_id, from_value, to_value)
    values (new.id, 'contact_logged', auth.uid(), old.last_contact_at::text, new.last_contact_at::text);
  end if;

  if old.lead_quality is distinct from new.lead_quality then
    insert into public.crm_record_events(record_id, event_type, actor_id, from_value, to_value)
    values (new.id, 'quality_changed', auth.uid(), old.lead_quality, new.lead_quality);
  end if;

  return new;
end
$$;

revoke all on function public.log_crm_record_event() from public, anon, authenticated;

drop trigger if exists trg_crm_record_events on public.crm_records;

create trigger trg_crm_record_events
after insert or update on public.crm_records
for each row execute function public.log_crm_record_event();

create table if not exists public.crm_weekly_reports (
  id bigint generated always as identity primary key,
  week_start date not null unique,
  week_end date not null,
  summary jsonb not null,
  generated_at timestamptz not null default now()
);

alter table public.crm_weekly_reports enable row level security;

grant select on public.crm_weekly_reports to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'crm_weekly_reports'
      and policyname = 'crm_weekly_reports_authenticated_select'
  ) then
    create policy crm_weekly_reports_authenticated_select
      on public.crm_weekly_reports
      for select
      to authenticated
      using (auth.uid() is not null);
  end if;
end
$$;

create or replace function public.generate_crm_weekly_report()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_week_end date := v_today - 1;
  v_week_start date := v_today - 7;
  v_new_leads integer := 0;
  v_stage_moves integer := 0;
  v_contacts integer := 0;
  v_active_leads integer := 0;
  v_scheduled_leads integer := 0;
  v_assessed integer := 0;
  v_fit integer := 0;
  v_unassessed integer := 0;
  v_overdue integer := 0;
  v_report_id bigint;
begin
  select count(*) into v_new_leads
  from public.crm_records
  where coalesce(record_type, 'lead') = 'lead'
    and created_at >= v_week_start::timestamp at time zone 'America/Sao_Paulo'
    and created_at < (v_week_end + 1)::timestamp at time zone 'America/Sao_Paulo';

  select
    count(*) filter (where event_type = 'stage_changed'),
    count(*) filter (where event_type = 'contact_logged')
  into v_stage_moves, v_contacts
  from public.crm_record_events
  where occurred_at >= v_week_start::timestamp at time zone 'America/Sao_Paulo'
    and occurred_at < (v_week_end + 1)::timestamp at time zone 'America/Sao_Paulo';

  select
    count(*),
    count(*) filter (where next_action_at >= now()),
    count(*) filter (where lead_quality <> 'Não avaliado'),
    count(*) filter (where lead_quality in ('Perfil Criare', 'Potencial')),
    count(*) filter (where lead_quality = 'Não avaliado'),
    count(*) filter (where next_action_at < now())
  into v_active_leads, v_scheduled_leads, v_assessed, v_fit, v_unassessed, v_overdue
  from public.crm_records
  where coalesce(record_type, 'lead') = 'lead'
    and pipeline = 'lead'
    and stage <> 'Perdido';

  insert into public.crm_weekly_reports(week_start, week_end, summary, generated_at)
  values (
    v_week_start,
    v_week_end,
    jsonb_build_object(
      'new_leads', v_new_leads,
      'stage_moves', v_stage_moves,
      'contacts', v_contacts,
      'active_leads', v_active_leads,
      'scheduled_leads', v_scheduled_leads,
      'followup_coverage_pct', case when v_active_leads = 0 then null else round((v_scheduled_leads::numeric / v_active_leads) * 100) end,
      'assessed_leads', v_assessed,
      'fit_or_potential', v_fit,
      'fit_pct', case when v_assessed = 0 then null else round((v_fit::numeric / v_assessed) * 100) end,
      'unassessed_leads', v_unassessed,
      'overdue_followups', v_overdue
    ),
    now()
  )
  on conflict (week_start) do update
  set week_end = excluded.week_end,
      summary = excluded.summary,
      generated_at = excluded.generated_at
  returning id into v_report_id;

  return v_report_id;
end
$$;

-- Somente a rotina interna do banco deve consolidar o resumo.
revoke all on function public.generate_crm_weekly_report() from public, anon, authenticated;

-- O banco do Supabase opera em UTC. 12:00 UTC corresponde a 09:00 em
-- America/Sao_Paulo. O job consolida a semana anterior toda segunda-feira.
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'crm-weekly-lead-quality'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'crm-weekly-lead-quality',
    '0 12 * * 1',
    'select public.generate_crm_weekly_report()'
  );
end
$$;

-- Verificação sugerida após aplicar:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'crm_records'
-- order by ordinal_position;
