-- Histórico mínimo para análises de perdas da Criare.
-- Exclusões anteriores a esta migration não podem ser recuperadas.

create table if not exists public.crm_record_loss_archive (
  id bigint generated always as identity primary key,
  original_record_id uuid not null,
  record_snapshot jsonb not null,
  deletion_reason text not null default 'Exclusão no CRM',
  deleted_by uuid null references public.crm_profiles(id) on delete set null,
  deleted_at timestamptz not null default now()
);

create index if not exists idx_crm_record_loss_archive_deleted_at
  on public.crm_record_loss_archive (deleted_at desc);

create index if not exists idx_crm_record_loss_archive_original_record
  on public.crm_record_loss_archive (original_record_id);

alter table public.crm_record_loss_archive enable row level security;

grant select on public.crm_record_loss_archive to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'crm_record_loss_archive'
      and policyname = 'crm_record_loss_archive_authenticated_select'
  ) then
    create policy crm_record_loss_archive_authenticated_select
      on public.crm_record_loss_archive
      for select
      to authenticated
      using (auth.uid() is not null);
  end if;
end
$$;

create or replace function public.archive_crm_record_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.record_type, 'lead') = 'lead' then
    insert into public.crm_record_loss_archive (
      original_record_id, record_snapshot, deletion_reason, deleted_by
    ) values (
      old.id, to_jsonb(old), 'Exclusão no CRM', auth.uid()
    );
  end if;
  return old;
end
$$;

revoke all on function public.archive_crm_record_before_delete() from public, anon, authenticated;

drop trigger if exists trg_archive_crm_record_before_delete on public.crm_records;

create trigger trg_archive_crm_record_before_delete
before delete on public.crm_records
for each row execute function public.archive_crm_record_before_delete();

-- Torna "Cancelado" uma classificação explícita de perda, sem alterar os registros existentes.
update public.crm_config
set lost_reasons = case
  when jsonb_typeof(lost_reasons) = 'array'
       and not (lost_reasons ? 'Cancelado pelo cliente')
    then lost_reasons || jsonb_build_array('Cancelado pelo cliente')
  else lost_reasons
end
where id = 1;
