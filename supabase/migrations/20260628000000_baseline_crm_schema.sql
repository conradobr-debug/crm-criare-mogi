-- Baseline idempotente do schema que antecedia o histórico versionado.
-- Em produção as tabelas já existem; em ambiente limpo permite reproduzir migrations.

create table if not exists public.crm_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_records (
  id uuid primary key default gen_random_uuid(),
  pipeline text not null check(pipeline in ('lead','closed')),
  stage text not null,
  stage_entered_at timestamptz not null default now(),
  source text,
  rooms text not null,
  city text not null,
  phone text not null,
  email text,
  estimate numeric,
  next_action date,
  lost_reason text,
  notes text,
  owner_id uuid references public.crm_profiles(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_name text,
  last_name text,
  rd_payload jsonb,
  rd_fingerprint text,
  rd_event_name text,
  rd_conversion_id text,
  rd_conversion_at timestamptz,
  rd_source text
);

create unique index if not exists ux_crm_records_rd_fingerprint on public.crm_records(rd_fingerprint) where rd_fingerprint is not null;
create index if not exists idx_crm_records_pipeline on public.crm_records(pipeline);
create index if not exists idx_crm_records_stage on public.crm_records(stage);
create index if not exists idx_crm_records_owner on public.crm_records(owner_id);
create index if not exists idx_crm_records_source on public.crm_records(source);
create index if not exists idx_crm_records_stage_entered on public.crm_records(stage_entered_at);
create index if not exists idx_crm_records_next_action on public.crm_records(next_action);

create table if not exists public.crm_config (
  id integer primary key,
  sources jsonb not null default '[]'::jsonb,
  lost_reasons jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;
do $$ begin
  if not exists(select 1 from pg_trigger where tgrelid='public.crm_profiles'::regclass and tgname='trg_profiles_updated_at') then
    create trigger trg_profiles_updated_at before update on public.crm_profiles for each row execute function public.set_updated_at();
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.crm_records'::regclass and tgname='trg_records_updated_at') then
    create trigger trg_records_updated_at before update on public.crm_records for each row execute function public.set_updated_at();
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.crm_config'::regclass and tgname='trg_config_updated_at') then
    create trigger trg_config_updated_at before update on public.crm_config for each row execute function public.set_updated_at();
  end if;
end $$;

do $$ begin
  if not (select relrowsecurity from pg_class where oid='public.crm_profiles'::regclass) then alter table public.crm_profiles enable row level security; end if;
  if not (select relrowsecurity from pg_class where oid='public.crm_records'::regclass) then alter table public.crm_records enable row level security; end if;
  if not (select relrowsecurity from pg_class where oid='public.crm_config'::regclass) then alter table public.crm_config enable row level security; end if;
end $$;
grant select,insert,update on public.crm_profiles to authenticated;
grant select,insert,update,delete on public.crm_records to authenticated;
grant select,insert,update on public.crm_config to authenticated;

do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='crm_profiles' and policyname='profiles_select_all') then create policy profiles_select_all on public.crm_profiles for select to authenticated using(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='crm_profiles' and policyname='profiles_insert_own') then create policy profiles_insert_own on public.crm_profiles for insert to authenticated with check(auth.uid()=id); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='crm_profiles' and policyname='profiles_update_own') then create policy profiles_update_own on public.crm_profiles for update to authenticated using(auth.uid()=id) with check(auth.uid()=id); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='crm_records' and policyname='records_select_all') then create policy records_select_all on public.crm_records for select to authenticated using(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='crm_records' and policyname='records_insert_all') then create policy records_insert_all on public.crm_records for insert to authenticated with check(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='crm_records' and policyname='records_update_all') then create policy records_update_all on public.crm_records for update to authenticated using(true) with check(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='crm_records' and policyname='records_delete_all') then create policy records_delete_all on public.crm_records for delete to authenticated using(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='crm_config' and policyname='config_rw') then create policy config_rw on public.crm_config to authenticated using(true) with check(true); end if;
end $$;
