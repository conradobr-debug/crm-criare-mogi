-- Sistema de relacionamento com parceiros da Criare Mogi Guaçu.
-- Migração aditiva e idempotente: preserva registros, compromissos e histórico.

alter table public.crm_records
  add column if not exists partner_classification text not null default 'Não classificado',
  add column if not exists relationship_level text not null default 'Novo',
  add column if not exists first_visit_at timestamptz null,
  add column if not exists region text null,
  add column if not exists project_profile text null,
  add column if not exists client_profile text null,
  add column if not exists preferred_styles text[] not null default '{}'::text[],
  add column if not exists preferred_environments text[] not null default '{}'::text[],
  add column if not exists current_suppliers text null,
  add column if not exists valued_differentials text null,
  add column if not exists objections text null,
  add column if not exists mentioned_projects text null,
  add column if not exists interest_tags text[] not null default '{}'::text[],
  add column if not exists partner_origin text null,
  add column if not exists cadence_type text not null default 'Manual',
  add column if not exists cadence_active boolean not null default false,
  add column if not exists cadence_started_at timestamptz null,
  add column if not exists cadence_cycle integer not null default 0,
  add column if not exists next_action_owner uuid null references public.crm_profiles(id) on delete set null,
  add column if not exists no_next_action_reason text null,
  add column if not exists interactions jsonb not null default '[]'::jsonb,
  add column if not exists sent_contents jsonb not null default '[]'::jsonb,
  add column if not exists cadence_history jsonb not null default '[]'::jsonb;

-- Migração explícita do funil anterior, sem alterar os demais pipelines.
update public.crm_records
set relationship_level = case
  when stage = 'Parceiro Ativo' then 'Ativo'
  when stage = 'Relacionamento' then 'Em desenvolvimento'
  else relationship_level
end
where coalesce(record_type, 'lead') = 'specifier';

update public.crm_records
set stage = case stage
  when 'Primeiro Contato' then 'Contato iniciado'
  when 'Parceiro Ativo' then 'Parceiro ativo'
  when 'Pausado' then 'Adormecido'
  else stage
end
where coalesce(record_type, 'lead') = 'specifier';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_records_partner_classification_check'
      and conrelid = 'public.crm_records'::regclass
  ) then
    alter table public.crm_records
      add constraint crm_records_partner_classification_check
      check (partner_classification in ('A — Estratégico', 'B — Potencial', 'C — Relacionamento', 'Não classificado'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_records_relationship_level_check'
      and conrelid = 'public.crm_records'::regclass
  ) then
    alter table public.crm_records
      add constraint crm_records_relationship_level_check
      check (relationship_level in ('Novo', 'Em desenvolvimento', 'Ativo', 'Recorrente'));
  end if;
end
$$;

create index if not exists idx_crm_records_partner_classification
  on public.crm_records (partner_classification)
  where coalesce(record_type, 'lead') = 'specifier';

create index if not exists idx_crm_records_partner_next_action
  on public.crm_records (next_action_at)
  where coalesce(record_type, 'lead') = 'specifier';

create index if not exists idx_crm_records_partner_interest_tags
  on public.crm_records using gin (interest_tags);

create table if not exists public.crm_partner_contents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  pillar text not null,
  format text not null,
  description text null,
  external_url text null,
  tags text[] not null default '{}'::text[],
  status text not null default 'Ativo' check (status in ('Ativo', 'Arquivado')),
  registered_at timestamptz not null default now(),
  notes text null,
  created_by uuid null references public.crm_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_partner_contents_status
  on public.crm_partner_contents (status, registered_at desc);
create index if not exists idx_crm_partner_contents_tags
  on public.crm_partner_contents using gin (tags);

alter table public.crm_partner_contents enable row level security;
grant select, insert, update, delete on public.crm_partner_contents to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'crm_partner_contents'
      and policyname = 'crm_partner_contents_authenticated_all'
  ) then
    create policy crm_partner_contents_authenticated_all
      on public.crm_partner_contents
      for all to authenticated
      using (auth.uid() is not null)
      with check (auth.uid() is not null);
  end if;
end
$$;

-- Permite que a importação de backup restaure a linha do tempo sem dar ao
-- navegador permissão para alterar eventos já existentes.
grant insert on public.crm_record_events to authenticated;
grant usage, select on sequence public.crm_record_events_id_seq to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'crm_record_events'
      and policyname = 'crm_record_events_authenticated_restore'
  ) then
    create policy crm_record_events_authenticated_restore
      on public.crm_record_events
      for insert to authenticated
      with check (auth.uid() is not null);
  end if;
end
$$;

create or replace function public.touch_crm_partner_content()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists trg_touch_crm_partner_content on public.crm_partner_contents;
create trigger trg_touch_crm_partner_content
before update on public.crm_partner_contents
for each row execute function public.touch_crm_partner_content();

-- Amplia o histórico já existente com mudanças próprias de relacionamento.
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
    values (new.id, 'stage_changed', auth.uid(), concat_ws(' / ', old.pipeline, old.stage), concat_ws(' / ', new.pipeline, new.stage));
  end if;

  if old.next_action_at is distinct from new.next_action_at
     or old.next_action is distinct from new.next_action then
    insert into public.crm_record_events(record_id, event_type, actor_id, from_value, to_value, metadata)
    values (new.id, 'followup_scheduled', auth.uid(), coalesce(old.next_action_at::text, old.next_action::text), coalesce(new.next_action_at::text, new.next_action::text), jsonb_build_object('kind', new.next_action_kind));
  end if;

  if old.last_contact_at is distinct from new.last_contact_at then
    insert into public.crm_record_events(record_id, event_type, actor_id, from_value, to_value)
    values (new.id, 'contact_logged', auth.uid(), old.last_contact_at::text, new.last_contact_at::text);
  end if;

  if old.lead_quality is distinct from new.lead_quality then
    insert into public.crm_record_events(record_id, event_type, actor_id, from_value, to_value)
    values (new.id, 'quality_changed', auth.uid(), old.lead_quality, new.lead_quality);
  end if;

  if old.partner_classification is distinct from new.partner_classification then
    insert into public.crm_record_events(record_id, event_type, actor_id, from_value, to_value)
    values (new.id, 'classification_changed', auth.uid(), old.partner_classification, new.partner_classification);
  end if;

  if old.relationship_level is distinct from new.relationship_level then
    insert into public.crm_record_events(record_id, event_type, actor_id, from_value, to_value)
    values (new.id, 'relationship_changed', auth.uid(), old.relationship_level, new.relationship_level);
  end if;

  if old.cadence_active is distinct from new.cadence_active
     or old.cadence_type is distinct from new.cadence_type then
    insert into public.crm_record_events(record_id, event_type, actor_id, from_value, to_value)
    values (new.id, case when new.cadence_active then 'cadence_activated' else 'cadence_paused' end, auth.uid(), old.cadence_type, new.cadence_type);
  end if;

  if old.owner_id is distinct from new.owner_id then
    insert into public.crm_record_events(record_id, event_type, actor_id, from_value, to_value)
    values (new.id, 'owner_changed', auth.uid(), old.owner_id::text, new.owner_id::text);
  end if;

  return new;
end
$$;

revoke all on function public.log_crm_record_event() from public, anon, authenticated;

-- Inclui o Banco de Conteúdos no canal compartilhado quando Realtime estiver ativo.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'crm_partner_contents'
     ) then
    alter publication supabase_realtime add table public.crm_partner_contents;
  end if;
end
$$;
