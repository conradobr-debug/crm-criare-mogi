-- Sincronização incremental leve e separação entre administração e operação comercial.

alter table public.crm_records
  add column if not exists whatsapp_last_checked_at timestamptz,
  add column if not exists whatsapp_observed_last_message_id text,
  add column if not exists whatsapp_observed_last_message_at timestamptz,
  add column if not exists whatsapp_external_chat_id text,
  add column if not exists whatsapp_sync_error text,
  add column if not exists whatsapp_sync_status text not null default 'unknown';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='crm_records_whatsapp_sync_status_check'
      and conrelid='public.crm_records'::regclass
  ) then
    alter table public.crm_records add constraint crm_records_whatsapp_sync_status_check
      check (whatsapp_sync_status in ('unknown','current','awaiting_analysis','verification_required'));
  end if;
end $$;

create index if not exists idx_crm_records_whatsapp_last_checked
  on public.crm_records(whatsapp_last_checked_at desc);

create or replace function public.crm_is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1 from public.crm_workspace_members
    where workspace_id=p_workspace_id and user_id=auth.uid() and role='admin'
  )
$$;

revoke all on function public.crm_is_workspace_admin(uuid) from public, anon;
grant execute on function public.crm_is_workspace_admin(uuid) to authenticated;

-- A administração fica com o perfil do Conrado. Todos os demais perfis atuais
-- e futuros permanecem como membros comerciais.
update public.crm_workspace_members member
set role=case when lower(trim(profile.display_name)) like 'conrado%' then 'admin' else 'member' end
from public.crm_profiles profile
where profile.id=member.user_id
  and member.workspace_id='00000000-0000-4000-8000-000000000001';

comment on column public.crm_records.whatsapp_last_checked_at is
  'Última varredura local confirmada pela extensão; não contém conteúdo da conversa.';
comment on column public.crm_records.whatsapp_observed_last_message_id is
  'ID da última mensagem observada na varredura leve do WhatsApp Web.';
comment on column public.crm_records.whatsapp_sync_status is
  'Estado leve da sincronização local, separado do estado da análise comercial.';
comment on column public.crm_records.whatsapp_sync_error is
  'Última falha técnica da varredura local; nunca contém o conteúdo da conversa.';
