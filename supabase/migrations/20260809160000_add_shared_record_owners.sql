-- Permite que um mesmo cliente tenha mais de um responsável no CRM.
-- owner_id permanece como responsável principal por compatibilidade com integrações existentes.
alter table public.crm_records
  add column if not exists owner_ids uuid[] not null default '{}'::uuid[];

update public.crm_records
set owner_ids = array[owner_id]
where coalesce(array_length(owner_ids, 1), 0) = 0
  and owner_id is not null;

create index if not exists idx_crm_records_owner_ids_gin
  on public.crm_records using gin (owner_ids);

comment on column public.crm_records.owner_ids is
  'Responsáveis do cadastro. owner_id preserva o responsável principal para compatibilidade.';
