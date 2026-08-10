-- Permite responsabilidade compartilhada também para assistências e pendências.
alter table public.crm_pending_items
  add column if not exists owner_ids uuid[] not null default '{}';

update public.crm_pending_items
set owner_ids = array[owner_id]
where owner_id is not null
  and coalesce(cardinality(owner_ids), 0) = 0;

create index if not exists idx_crm_pending_items_owner_ids
  on public.crm_pending_items using gin (owner_ids);
