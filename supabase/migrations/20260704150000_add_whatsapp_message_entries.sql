alter table public.crm_records
  add column if not exists whatsapp_message_entries jsonb not null default '[]'::jsonb,
  add column if not exists whatsapp_sync_new_message_count integer not null default 0;

comment on column public.crm_records.whatsapp_message_entries is
  'Mensagens individuais do WhatsApp preservadas para sincronização incremental sem duplicação.';

comment on column public.crm_records.whatsapp_sync_new_message_count is
  'Quantidade de mensagens novas acrescentadas na atualização mais recente.';
