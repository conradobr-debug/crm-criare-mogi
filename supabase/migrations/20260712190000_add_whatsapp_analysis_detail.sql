alter table public.crm_records
  add column if not exists whatsapp_analysis_hard_boss text,
  add column if not exists whatsapp_analysis_full text,
  add column if not exists whatsapp_analysis_updated_at timestamptz,
  add column if not exists whatsapp_analysis_model text,
  add column if not exists whatsapp_capture_complete boolean not null default false,
  add column if not exists whatsapp_capture_note text;

update public.crm_records
set
  whatsapp_analysis_hard_boss = coalesce(whatsapp_analysis_hard_boss, whatsapp_summary),
  whatsapp_analysis_updated_at = coalesce(whatsapp_analysis_updated_at, whatsapp_summary_updated_at),
  whatsapp_analysis_model = coalesce(whatsapp_analysis_model, whatsapp_summary_model)
where whatsapp_summary is not null;

comment on column public.crm_records.whatsapp_analysis_hard_boss is
  'Parágrafo final Chefe Duro fixado no lead.';
comment on column public.crm_records.whatsapp_analysis_full is
  'Resposta integral da análise da conversa, aberta sob demanda.';
comment on column public.crm_records.whatsapp_capture_complete is
  'Indica se a extensão alcançou o início da conversa sem atingir o limite de segurança.';
comment on column public.crm_records.whatsapp_capture_note is
  'Diagnóstico da completude da captura mais recente.';
