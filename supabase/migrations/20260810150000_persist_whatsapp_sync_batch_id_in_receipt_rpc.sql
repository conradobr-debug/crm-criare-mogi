-- O RPC de recibo aplica o lote de uma vez; ele também precisa persistir
-- o batch_id que será exigido pela importação da análise local 1.3.
create or replace function public.crm_apply_whatsapp_sync_receipt(
  p_workspace_id uuid,
  p_batch_id text,
  p_updates jsonb,
  p_candidates jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_item jsonb;
  v_candidate jsonb;
  v_external text;
  v_phone text;
  v_match uuid;
  v_updated integer := 0;
  v_saved integer := 0;
  v_known integer := 0;
begin
  if auth.uid() is null or not public.crm_is_workspace_admin(p_workspace_id) then
    raise exception 'Apenas o administrador pode atualizar a sincronização do WhatsApp.' using errcode='42501';
  end if;
  if jsonb_typeof(p_updates) <> 'array' or jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'Lote de sincronização inválido.' using errcode='22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_updates)
  loop
    update public.crm_records record set
      whatsapp_last_checked_at = case when v_item ? 'whatsapp_last_checked_at' then nullif(v_item->>'whatsapp_last_checked_at','')::timestamptz else record.whatsapp_last_checked_at end,
      whatsapp_observed_last_message_id = case when v_item ? 'whatsapp_observed_last_message_id' then nullif(v_item->>'whatsapp_observed_last_message_id','') else record.whatsapp_observed_last_message_id end,
      whatsapp_observed_last_message_at = case when v_item ? 'whatsapp_observed_last_message_at' then nullif(v_item->>'whatsapp_observed_last_message_at','')::timestamptz else record.whatsapp_observed_last_message_at end,
      whatsapp_sync_batch_id = p_batch_id,
      whatsapp_external_chat_id = case when v_item ? 'whatsapp_external_chat_id' then nullif(v_item->>'whatsapp_external_chat_id','') else record.whatsapp_external_chat_id end,
      whatsapp_sync_status = case when v_item ? 'whatsapp_sync_status' then nullif(v_item->>'whatsapp_sync_status','') else record.whatsapp_sync_status end,
      whatsapp_sync_error = case when v_item ? 'whatsapp_sync_error' then nullif(v_item->>'whatsapp_sync_error','') else record.whatsapp_sync_error end,
      whatsapp_analysis_status = case when v_item ? 'whatsapp_analysis_status' then nullif(v_item->>'whatsapp_analysis_status','') else record.whatsapp_analysis_status end,
      updated_at = now()
    where record.id = nullif(v_item->>'id','')::uuid
      and record.workspace_id = p_workspace_id;
    if found then v_updated := v_updated + 1; end if;
  end loop;

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    v_external := nullif(trim(v_candidate->>'external_chat_id'),'');
    if v_external is null then continue; end if;
    v_phone := regexp_replace(coalesce(v_candidate->>'phone_e164',''),'[^0-9]','','g');
    v_match := null;

    select record.id into v_match from public.crm_records record
    where record.workspace_id = p_workspace_id and (nullif(record.whatsapp_external_chat_id,'') = v_external or (length(v_phone) between 8 and 15 and regexp_replace(coalesce(record.phone,''),'[^0-9]','','g') = v_phone))
    order by case when record.whatsapp_external_chat_id = v_external then 0 else 1 end limit 1;

    insert into public.crm_whatsapp_lead_candidates(workspace_id, external_chat_id, contact_wa_id, phone_e164, display_name, last_message_id, last_message_at, source_batch_id, status, matched_record_id, created_by)
    values (p_workspace_id, v_external, nullif(v_candidate->>'contact_wa_id',''), nullif(v_candidate->>'phone_e164',''), nullif(v_candidate->>'display_name',''), nullif(v_candidate->>'last_message_id',''), nullif(v_candidate->>'last_message_at','')::timestamptz, p_batch_id, case when v_match is null then 'pending' else 'known' end, v_match, auth.uid())
    on conflict(workspace_id, external_chat_id) do update set contact_wa_id=coalesce(excluded.contact_wa_id,crm_whatsapp_lead_candidates.contact_wa_id), phone_e164=coalesce(excluded.phone_e164,crm_whatsapp_lead_candidates.phone_e164), display_name=coalesce(excluded.display_name,crm_whatsapp_lead_candidates.display_name), last_message_id=coalesce(excluded.last_message_id,crm_whatsapp_lead_candidates.last_message_id), last_message_at=coalesce(excluded.last_message_at,crm_whatsapp_lead_candidates.last_message_at), source_batch_id=excluded.source_batch_id, last_seen_at=now(), updated_at=now(), matched_record_id=coalesce(v_match,crm_whatsapp_lead_candidates.matched_record_id), status=case when v_match is not null then 'known' else crm_whatsapp_lead_candidates.status end;
    if v_match is null then v_saved := v_saved + 1; else v_known := v_known + 1; end if;
  end loop;
  return jsonb_build_object('updated',v_updated,'saved',v_saved,'known',v_known);
end
$$;

revoke all on function public.crm_apply_whatsapp_sync_receipt(uuid,text,jsonb,jsonb) from public, anon;
grant execute on function public.crm_apply_whatsapp_sync_receipt(uuid,text,jsonb,jsonb) to authenticated;
