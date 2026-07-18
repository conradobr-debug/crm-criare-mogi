-- Escopo mínimo para identidade telefônica por operação; não altera políticas RLS.
alter table public.crm_records
  add column if not exists workspace_id uuid references public.crm_workspaces(id) on delete restrict;

update public.crm_records set workspace_id='00000000-0000-4000-8000-000000000001' where workspace_id is null;

alter table public.crm_records
  alter column workspace_id set default '00000000-0000-4000-8000-000000000001',
  alter column workspace_id set not null;

create index if not exists idx_crm_records_workspace_phone on public.crm_records(workspace_id, phone);

create or replace function public.link_crm_whatsapp_messages()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_phone text; v_count integer;
begin
  v_phone:=regexp_replace(coalesce(new.phone,''),'[^0-9]','','g');
  if v_phone='' then return new; end if;
  select count(*) into v_count from public.crm_records where workspace_id=new.workspace_id and regexp_replace(coalesce(phone,''),'[^0-9]','','g')=v_phone;
  if v_count=1 then
    update public.crm_whatsapp_conversations set record_id=new.id,match_status='matched',match_details=jsonb_build_object('method','normalized_phone','count',1),updated_at=now() where workspace_id=new.workspace_id and contact_wa_id=v_phone;
    update public.crm_whatsapp_messages set record_id=new.id,updated_at=now() where workspace_id=new.workspace_id and contact_wa_id=v_phone and record_id is distinct from new.id;
  else
    update public.crm_whatsapp_conversations set record_id=null,match_status='ambiguous',match_details=jsonb_build_object('method','normalized_phone','count',v_count),updated_at=now() where workspace_id=new.workspace_id and contact_wa_id=v_phone;
  end if;
  return new;
end $$;
revoke all on function public.link_crm_whatsapp_messages() from public,anon,authenticated;
grant execute on function public.link_crm_whatsapp_messages() to service_role;
