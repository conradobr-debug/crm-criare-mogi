-- Mantém somente o resumo comercial da conversa. O texto bruto colado pelo
-- usuário é processado em memória e não é persistido no banco.
alter table public.crm_records
  add column if not exists whatsapp_summary text,
  add column if not exists whatsapp_summary_updated_at timestamptz,
  add column if not exists whatsapp_summary_model text;

comment on column public.crm_records.whatsapp_summary is
  'Resumo comercial de um trecho de conversa do WhatsApp colado pelo usuário.';
comment on column public.crm_records.whatsapp_summary_updated_at is
  'Data da última geração ou edição do resumo do WhatsApp.';
comment on column public.crm_records.whatsapp_summary_model is
  'Origem do resumo: modelo de IA ou análise local de contingência.';
