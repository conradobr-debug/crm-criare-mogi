-- Permite que contatos exclusivamente de assistência/pós-venda tenham uma
-- conversa própria, sem aparecer nos funis comercial ou de parceiros.

alter table public.crm_records
  drop constraint if exists crm_records_pipeline_check;

alter table public.crm_records
  add constraint crm_records_pipeline_check
  check (pipeline in ('lead', 'closed', 'support'));

alter table public.crm_records
  drop constraint if exists crm_records_record_type_check;

alter table public.crm_records
  add constraint crm_records_record_type_check
  check (record_type in ('lead', 'specifier', 'pending_contact'));

alter table public.crm_pending_items
  add column if not exists whatsapp_record_id uuid null
  references public.crm_records(id) on delete set null;

create index if not exists idx_crm_pending_items_whatsapp_record
  on public.crm_pending_items(whatsapp_record_id)
  where whatsapp_record_id is not null;

comment on column public.crm_pending_items.whatsapp_record_id is
  'Cadastro técnico interno usado para sincronizar e analisar a conversa de WhatsApp de uma pendência.';
