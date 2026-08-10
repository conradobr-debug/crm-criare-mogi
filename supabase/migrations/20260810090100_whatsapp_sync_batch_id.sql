-- Vincula o resultado da IA ao recibo exato da sincronização diária.
alter table public.crm_records
  add column if not exists whatsapp_sync_batch_id text null;

create index if not exists idx_crm_records_whatsapp_sync_batch_id
  on public.crm_records (whatsapp_sync_batch_id)
  where whatsapp_sync_batch_id is not null;
