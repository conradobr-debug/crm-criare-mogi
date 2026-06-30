-- Evolução do CRM: agenda Outlook direta, pendências com fotos e funil Viver Criare.
-- Migração aditiva: preserva registros, relatórios e histórico existentes.

alter table public.crm_records
  add column if not exists next_action_details text null,
  add column if not exists next_action_duration_minutes integer not null default 30,
  add column if not exists next_action_reminder_minutes integer not null default 30,
  add column if not exists outlook_event_id text null,
  add column if not exists outlook_event_web_link text null,
  add column if not exists outlook_synced_at timestamptz null,
  add column if not exists property_status text not null default 'Não informado',
  add column if not exists professional_name text null,
  add column if not exists has_floor_plan boolean null,
  add column if not exists preferred_contact text not null default 'WhatsApp',
  add column if not exists investment_profile text not null default 'A definir',
  add column if not exists decision_due_at date null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_records_next_action_duration_check'
      and conrelid = 'public.crm_records'::regclass
  ) then
    alter table public.crm_records
      add constraint crm_records_next_action_duration_check
      check (next_action_duration_minutes in (15, 30, 45, 60, 90, 120, 180));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_records_next_action_reminder_check'
      and conrelid = 'public.crm_records'::regclass
  ) then
    alter table public.crm_records
      add constraint crm_records_next_action_reminder_check
      check (next_action_reminder_minutes in (0, 15, 30, 60, 120, 1440));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_records_property_status_check'
      and conrelid = 'public.crm_records'::regclass
  ) then
    alter table public.crm_records add constraint crm_records_property_status_check
      check (property_status in ('Não informado', 'Pronto', 'Em obra', 'Em construção', 'Ainda não iniciado'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_records_preferred_contact_check'
      and conrelid = 'public.crm_records'::regclass
  ) then
    alter table public.crm_records add constraint crm_records_preferred_contact_check
      check (preferred_contact in ('WhatsApp', 'Ligação', 'E-mail'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_records_investment_profile_check'
      and conrelid = 'public.crm_records'::regclass
  ) then
    alter table public.crm_records add constraint crm_records_investment_profile_check
      check (investment_profile in ('A definir', 'Essencial', 'Equilibrado', 'Completo'));
  end if;
end
$$;

create index if not exists idx_crm_records_decision_due_at
  on public.crm_records (decision_due_at);

-- Tradução do funil antigo para o modelo Conquistar → Convencer → Vender.
update public.crm_records
set stage = case stage
  when 'Atendimento Inicial' then 'Recepção e sondagem'
  when 'Só quer preço' then 'Qualificação'
  when 'Projeto' then 'Projeto em desenvolvimento'
  when 'Apresentação' then 'Apresentação agendada'
  when 'Enrolação' then 'Acompanhamento'
  else stage
end
where coalesce(record_type, 'lead') = 'lead'
  and pipeline = 'lead';

update public.crm_records
set stage = case stage
  when 'Contrato Realizado' then 'Contrato realizado'
  when 'Medição Técnica' then 'Medição final'
  when 'Projeto Executivo' then 'Projeto executivo'
  when 'Pedido' then 'Pedido em fábrica'
  when 'Liberação Fábrica' then 'Produção e transporte'
  when 'Agendamento de Montagem' then 'Montagem agendada'
  when 'Entrega' then 'Entrega técnica'
  when 'Pós Venda' then 'Pós-venda'
  else stage
end
where coalesce(record_type, 'lead') = 'lead'
  and pipeline = 'closed';

create table if not exists public.crm_pending_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  pending_type text not null default 'Assistência técnica',
  description text null,
  customer_name text null,
  customer_phone text null,
  city text null,
  address text null,
  owner_id uuid null references public.crm_profiles(id) on delete set null,
  priority text not null default 'Normal',
  due_at timestamptz null,
  status text not null default 'open',
  completed_at timestamptz null,
  completed_by uuid null references public.crm_profiles(id) on delete set null,
  created_by uuid not null references public.crm_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_pending_items_type_check check (
    pending_type in ('Assistência técnica', 'Vistoria', 'Pedir peça', 'Comprar item', 'Outro')
  ),
  constraint crm_pending_items_priority_check check (priority in ('Baixa', 'Normal', 'Alta', 'Urgente')),
  constraint crm_pending_items_status_check check (status in ('open', 'completed'))
);

create index if not exists idx_crm_pending_items_status_due
  on public.crm_pending_items (status, due_at);

create index if not exists idx_crm_pending_items_owner
  on public.crm_pending_items (owner_id, status);

create or replace function public.touch_crm_pending_item()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(new.completed_by, auth.uid());
  elsif new.status = 'open' then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end
$$;

drop trigger if exists trg_touch_crm_pending_item on public.crm_pending_items;
create trigger trg_touch_crm_pending_item
before update on public.crm_pending_items
for each row execute function public.touch_crm_pending_item();

revoke all on function public.touch_crm_pending_item() from public, anon, authenticated;

alter table public.crm_pending_items enable row level security;
grant select, insert, update, delete on public.crm_pending_items to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'crm_pending_items' and policyname = 'crm_pending_items_authenticated_select'
  ) then
    create policy crm_pending_items_authenticated_select on public.crm_pending_items
      for select to authenticated using (auth.uid() is not null);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'crm_pending_items' and policyname = 'crm_pending_items_authenticated_insert'
  ) then
    create policy crm_pending_items_authenticated_insert on public.crm_pending_items
      for insert to authenticated with check (auth.uid() = created_by);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'crm_pending_items' and policyname = 'crm_pending_items_authenticated_update'
  ) then
    create policy crm_pending_items_authenticated_update on public.crm_pending_items
      for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'crm_pending_items' and policyname = 'crm_pending_items_authenticated_delete'
  ) then
    create policy crm_pending_items_authenticated_delete on public.crm_pending_items
      for delete to authenticated using (auth.uid() is not null);
  end if;
end
$$;

create table if not exists public.crm_pending_attachments (
  id uuid primary key default gen_random_uuid(),
  pending_id uuid not null references public.crm_pending_items(id) on delete cascade,
  object_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_by uuid not null references public.crm_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_pending_attachments_pending
  on public.crm_pending_attachments (pending_id, created_at);

alter table public.crm_pending_attachments enable row level security;
grant select, insert, delete on public.crm_pending_attachments to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'crm_pending_attachments' and policyname = 'crm_pending_attachments_authenticated_select'
  ) then
    create policy crm_pending_attachments_authenticated_select on public.crm_pending_attachments
      for select to authenticated using (auth.uid() is not null);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'crm_pending_attachments' and policyname = 'crm_pending_attachments_authenticated_insert'
  ) then
    create policy crm_pending_attachments_authenticated_insert on public.crm_pending_attachments
      for insert to authenticated with check (auth.uid() = created_by);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'crm_pending_attachments' and policyname = 'crm_pending_attachments_authenticated_delete'
  ) then
    create policy crm_pending_attachments_authenticated_delete on public.crm_pending_attachments
      for delete to authenticated using (auth.uid() is not null);
  end if;
end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crm-pending-photos',
  'crm-pending-photos',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage'
      and tablename = 'objects' and policyname = 'crm_pending_photos_authenticated_select'
  ) then
    create policy crm_pending_photos_authenticated_select on storage.objects
      for select to authenticated using (bucket_id = 'crm-pending-photos');
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'storage'
      and tablename = 'objects' and policyname = 'crm_pending_photos_authenticated_insert'
  ) then
    create policy crm_pending_photos_authenticated_insert on storage.objects
      for insert to authenticated with check (bucket_id = 'crm-pending-photos');
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'storage'
      and tablename = 'objects' and policyname = 'crm_pending_photos_authenticated_delete'
  ) then
    create policy crm_pending_photos_authenticated_delete on storage.objects
      for delete to authenticated using (bucket_id = 'crm-pending-photos');
  end if;
end
$$;

-- Conexão central do Outlook. Não há políticas para o front-end: somente a Edge Function
-- com service role pode ler os tokens criptografados.
create table if not exists public.crm_outlook_connection (
  id smallint primary key default 1 check (id = 1),
  microsoft_user_id text not null,
  account_email text not null,
  refresh_token_ciphertext text not null,
  scope text null,
  connected_by uuid null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_outlook_oauth_states (
  state text primary key,
  crm_user_id uuid not null,
  verifier_ciphertext text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.crm_outlook_connection enable row level security;
alter table public.crm_outlook_oauth_states enable row level security;
revoke all on public.crm_outlook_connection from public, anon, authenticated;
revoke all on public.crm_outlook_oauth_states from public, anon, authenticated;

-- Realtime para pendências e metadados de fotos.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_pending_items'
  ) then
    alter publication supabase_realtime add table public.crm_pending_items;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_pending_attachments'
  ) then
    alter publication supabase_realtime add table public.crm_pending_attachments;
  end if;
end
$$;

notify pgrst, 'reload schema';
