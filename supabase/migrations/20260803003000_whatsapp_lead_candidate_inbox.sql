-- Caixa administrativa persistente para conversas recentes do WhatsApp que
-- ainda não possuem vínculo confirmado com um lead. Não armazena mensagens
-- nem mídias; somente identificadores e metadados mínimos de triagem.

create table if not exists public.crm_whatsapp_lead_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  external_chat_id text not null,
  contact_wa_id text,
  phone_e164 text,
  display_name text,
  last_message_id text,
  last_message_at timestamptz,
  source_batch_id text,
  status text not null default 'pending'
    check (status in ('pending','converted','dismissed','known')),
  matched_record_id uuid references public.crm_records(id) on delete set null,
  matched_pending_id uuid references public.crm_pending_items(id) on delete set null,
  created_by uuid not null references public.crm_profiles(id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, external_chat_id)
);

create index if not exists idx_crm_wa_lead_candidates_pending
  on public.crm_whatsapp_lead_candidates(workspace_id, status, last_message_at desc);

alter table public.crm_whatsapp_lead_candidates enable row level security;
grant select, insert, update, delete on public.crm_whatsapp_lead_candidates to authenticated;

drop policy if exists crm_wa_lead_candidates_admin_select on public.crm_whatsapp_lead_candidates;
create policy crm_wa_lead_candidates_admin_select on public.crm_whatsapp_lead_candidates
  for select to authenticated using (public.crm_is_workspace_admin(workspace_id));
drop policy if exists crm_wa_lead_candidates_admin_insert on public.crm_whatsapp_lead_candidates;
create policy crm_wa_lead_candidates_admin_insert on public.crm_whatsapp_lead_candidates
  for insert to authenticated with check (
    public.crm_is_workspace_admin(workspace_id) and created_by=auth.uid()
  );
drop policy if exists crm_wa_lead_candidates_admin_update on public.crm_whatsapp_lead_candidates;
create policy crm_wa_lead_candidates_admin_update on public.crm_whatsapp_lead_candidates
  for update to authenticated using (public.crm_is_workspace_admin(workspace_id))
  with check (public.crm_is_workspace_admin(workspace_id));
drop policy if exists crm_wa_lead_candidates_admin_delete on public.crm_whatsapp_lead_candidates;
create policy crm_wa_lead_candidates_admin_delete on public.crm_whatsapp_lead_candidates
  for delete to authenticated using (public.crm_is_workspace_admin(workspace_id));

create or replace function public.crm_upsert_whatsapp_lead_candidates(
  p_workspace_id uuid,
  p_batch_id text,
  p_candidates jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_item jsonb;
  v_external text;
  v_phone text;
  v_match uuid;
  v_saved integer := 0;
  v_known integer := 0;
begin
  if auth.uid() is null or not public.crm_is_workspace_admin(p_workspace_id) then
    raise exception 'Apenas o administrador pode atualizar a caixa do WhatsApp.' using errcode='42501';
  end if;
  if jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'Lista de candidatos inválida.' using errcode='22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_candidates)
  loop
    v_external := nullif(trim(v_item->>'external_chat_id'),'');
    if v_external is null then continue; end if;
    v_phone := regexp_replace(coalesce(v_item->>'phone_e164',''),'[^0-9]','','g');
    v_match := null;

    select record.id into v_match
    from public.crm_records record
    where record.workspace_id=p_workspace_id
      and (
        nullif(record.whatsapp_external_chat_id,'')=v_external
        or (length(v_phone) between 8 and 15
          and regexp_replace(coalesce(record.phone,''),'[^0-9]','','g')=v_phone)
      )
    order by case when record.whatsapp_external_chat_id=v_external then 0 else 1 end
    limit 1;

    insert into public.crm_whatsapp_lead_candidates(
      workspace_id,external_chat_id,contact_wa_id,phone_e164,display_name,
      last_message_id,last_message_at,source_batch_id,status,matched_record_id,created_by
    ) values (
      p_workspace_id,v_external,nullif(v_item->>'contact_wa_id',''),
      nullif(v_item->>'phone_e164',''),nullif(v_item->>'display_name',''),
      nullif(v_item->>'last_message_id',''),nullif(v_item->>'last_message_at','')::timestamptz,
      p_batch_id,case when v_match is null then 'pending' else 'known' end,v_match,auth.uid()
    )
    on conflict(workspace_id,external_chat_id) do update set
      contact_wa_id=coalesce(excluded.contact_wa_id,crm_whatsapp_lead_candidates.contact_wa_id),
      phone_e164=coalesce(excluded.phone_e164,crm_whatsapp_lead_candidates.phone_e164),
      display_name=coalesce(excluded.display_name,crm_whatsapp_lead_candidates.display_name),
      last_message_id=coalesce(excluded.last_message_id,crm_whatsapp_lead_candidates.last_message_id),
      last_message_at=coalesce(excluded.last_message_at,crm_whatsapp_lead_candidates.last_message_at),
      source_batch_id=excluded.source_batch_id,
      last_seen_at=now(),updated_at=now(),
      matched_record_id=coalesce(v_match,crm_whatsapp_lead_candidates.matched_record_id),
      status=case
        when v_match is not null then 'known'
        else crm_whatsapp_lead_candidates.status
      end;

    if v_match is null then v_saved:=v_saved+1; else v_known:=v_known+1; end if;
  end loop;
  return jsonb_build_object('saved',v_saved,'known',v_known);
end
$$;

revoke all on function public.crm_upsert_whatsapp_lead_candidates(uuid,text,jsonb) from public,anon;
grant execute on function public.crm_upsert_whatsapp_lead_candidates(uuid,text,jsonb) to authenticated;

comment on table public.crm_whatsapp_lead_candidates is
  'Caixa administrativa de possíveis leads detectados no WhatsApp; não contém conversas nem mídias.';
