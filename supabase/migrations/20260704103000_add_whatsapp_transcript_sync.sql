-- Histórico capturado localmente pela extensão do WhatsApp Web.
-- O usuário autenticado do CRM pode atualizar estes campos pelas mesmas
-- políticas já aplicadas a crm_records.

alter table public.crm_records
  add column if not exists whatsapp_transcript text,
  add column if not exists whatsapp_transcript_updated_at timestamptz,
  add column if not exists whatsapp_sync_message_count integer not null default 0,
  add column if not exists whatsapp_sync_error text;

comment on column public.crm_records.whatsapp_transcript is
  'Histórico do WhatsApp Web capturado pela extensão Criare e mesclado sem duplicar linhas idênticas.';
comment on column public.crm_records.whatsapp_transcript_updated_at is
  'Data da última tentativa bem-sucedida de atualização automática da conversa.';
comment on column public.crm_records.whatsapp_sync_message_count is
  'Quantidade de mensagens encontradas na captura automática mais recente.';
comment on column public.crm_records.whatsapp_sync_error is
  'Falha mais recente da atualização automática; apagada após uma captura bem-sucedida.';
