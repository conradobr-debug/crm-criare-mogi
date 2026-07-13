-- Metadados aditivos da captura gratuita pelo WhatsApp Web.
-- Mantém as análises anteriores no próprio lead e não interfere na estrutura
-- oficial da WhatsApp Business Platform.

alter table public.crm_records
  add column if not exists whatsapp_analysis_history jsonb not null default '[]'::jsonb,
  add column if not exists whatsapp_capture_source text,
  add column if not exists whatsapp_capture_version text;

comment on column public.crm_records.whatsapp_analysis_history is
  'Últimas versões da análise substituídas no lead, para consulta e auditoria.';
comment on column public.crm_records.whatsapp_capture_source is
  'Origem da captura atualmente salva, por exemplo whatsapp_web_extension.';
comment on column public.crm_records.whatsapp_capture_version is
  'Versão do leitor que produziu a captura mais recente.';
