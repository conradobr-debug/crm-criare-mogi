-- Importação controlada de ZIPs gerados pela extensão local do WhatsApp.
-- As mensagens continuam no campo JSONB já utilizado pelo CRM; estas tabelas
-- registram lote, idempotência e snapshots suficientes para reversão segura.

create table if not exists public.crm_whatsapp_local_import_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  source_files jsonb not null default '[]'::jsonb,
  requested_by uuid not null references public.crm_profiles(id) on delete restrict,
  status text not null default 'applied' check (status in ('applied','reverted','failed')),
  item_count integer not null default 0,
  message_insert_count integer not null default 0,
  created_at timestamptz not null default now(),
  reverted_at timestamptz,
  reverted_by uuid references public.crm_profiles(id) on delete restrict,
  unique(workspace_id, source_hash)
);

create table if not exists public.crm_whatsapp_local_import_audits (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.crm_whatsapp_local_import_runs(id) on delete cascade,
  record_id uuid not null references public.crm_records(id) on delete restrict,
  conversation_id text not null,
  before_entries jsonb not null,
  after_entries jsonb not null,
  before_analysis_status text,
  after_analysis_status text,
  inserted_message_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(run_id, record_id, conversation_id)
);

create index if not exists idx_crm_wa_local_runs_workspace_created
  on public.crm_whatsapp_local_import_runs(workspace_id, created_at desc);
create index if not exists idx_crm_wa_local_audits_record
  on public.crm_whatsapp_local_import_audits(record_id, created_at desc);

alter table public.crm_whatsapp_local_import_runs enable row level security;
alter table public.crm_whatsapp_local_import_audits enable row level security;

drop policy if exists crm_wa_local_runs_read on public.crm_whatsapp_local_import_runs;
create policy crm_wa_local_runs_read on public.crm_whatsapp_local_import_runs
  for select to authenticated using (public.crm_has_workspace_access(workspace_id));
drop policy if exists crm_wa_local_audits_read on public.crm_whatsapp_local_import_audits;
create policy crm_wa_local_audits_read on public.crm_whatsapp_local_import_audits
  for select to authenticated using (
    exists(select 1 from public.crm_whatsapp_local_import_runs run where run.id=run_id and public.crm_has_workspace_access(run.workspace_id))
  );

-- p_payload deve conter um único workspace e itens já aprovados na tela local.
-- A função bloqueia IDs duplicados, confere workspace e grava tudo em uma única
-- transação. Não cria lead automaticamente.
create or replace function public.apply_crm_whatsapp_local_import(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_workspace uuid := nullif(p_payload->>'workspace_id','')::uuid;
  v_hash text := lower(coalesce(p_payload->>'source_hash',''));
  v_run public.crm_whatsapp_local_import_runs;
  v_item jsonb;
  v_message jsonb;
  v_record public.crm_records;
  v_before jsonb;
  v_after jsonb;
  v_entries jsonb;
  v_id text;
  v_inserted jsonb;
  v_item_count integer := 0;
  v_insert_count integer := 0;
  v_item_inserts integer;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória.' using errcode='42501'; end if;
  if v_workspace is null or not public.crm_has_workspace_access(v_workspace) then raise exception 'Sem acesso ao workspace.' using errcode='42501'; end if;
  if v_hash !~ '^[a-f0-9]{64}$' then raise exception 'Hash de origem inválido.' using errcode='22023'; end if;
  if jsonb_typeof(p_payload->'items') <> 'array' or jsonb_array_length(p_payload->'items')=0 then raise exception 'Lote sem itens.' using errcode='22023'; end if;

  select * into v_run from public.crm_whatsapp_local_import_runs where workspace_id=v_workspace and source_hash=v_hash;
  if found then
    return jsonb_build_object('status', case when v_run.status='applied' then 'already_applied' else v_run.status end, 'run_id',v_run.id,'message_insert_count',v_run.message_insert_count);
  end if;

  insert into public.crm_whatsapp_local_import_runs(workspace_id,source_hash,source_files,requested_by,status)
  values(v_workspace,v_hash,coalesce(p_payload->'source_files','[]'::jsonb),auth.uid(),'applied')
  returning * into v_run;

  for v_item in select value from jsonb_array_elements(p_payload->'items') loop
    if nullif(v_item->>'record_id','') is null or nullif(v_item->>'conversation_id','') is null then raise exception 'Item sem record_id ou conversation_id.' using errcode='22023'; end if;
    select * into v_record from public.crm_records where id=(v_item->>'record_id')::uuid and workspace_id=v_workspace for update;
    if not found then raise exception 'Lead não encontrado no workspace.' using errcode='22023'; end if;
    if jsonb_typeof(v_item->'messages') <> 'array' then raise exception 'Item sem mensagens.' using errcode='22023'; end if;

    v_before := coalesce(v_record.whatsapp_message_entries,'[]'::jsonb);
    v_entries := v_before;
    v_inserted := '[]'::jsonb;
    v_item_inserts := 0;
    for v_message in select value from jsonb_array_elements(v_item->'messages') loop
      v_id := nullif(v_message->>'message_id','');
      if v_id is null then raise exception 'Mensagem sem message_id.' using errcode='22023'; end if;
      if exists(select 1 from jsonb_array_elements(v_entries) entry where coalesce(entry->>'message_id',entry->>'id')=v_id) then continue; end if;
      v_entries := v_entries || jsonb_build_array(v_message);
      v_inserted := v_inserted || jsonb_build_array(v_id);
      v_item_inserts := v_item_inserts + 1;
    end loop;

    if v_item_inserts=0 then continue; end if;
    v_after := v_entries;
    update public.crm_records set
      whatsapp_message_entries=v_after,
      whatsapp_transcript=(select string_agg(coalesce(value->>'text',''),'\n' order by coalesce(value->>'sent_at',value->>'timestamp','')) from jsonb_array_elements(v_after)),
      whatsapp_transcript_updated_at=now(),
      whatsapp_sync_message_count=jsonb_array_length(v_after),
      whatsapp_sync_new_message_count=v_item_inserts,
      whatsapp_sync_error=null,
      whatsapp_capture_complete=coalesce((v_item->>'capture_complete')::boolean,false),
      whatsapp_capture_note='Importação local confirmada; histórico limitado ao que o WhatsApp Web sincronizou.',
      whatsapp_capture_source='arquivo_local_whatsapp',
      whatsapp_capture_version=coalesce(p_payload->>'exporter_version','unknown'),
      whatsapp_analysis_status=case when coalesce(v_record.whatsapp_analysis_updated_at,v_record.whatsapp_summary_updated_at) is not null then 'stale' else 'never' end
    where id=v_record.id;

    insert into public.crm_whatsapp_local_import_audits(run_id,record_id,conversation_id,before_entries,after_entries,before_analysis_status,after_analysis_status,inserted_message_ids)
    values(v_run.id,v_record.id,v_item->>'conversation_id',v_before,v_after,v_record.whatsapp_analysis_status,case when coalesce(v_record.whatsapp_analysis_updated_at,v_record.whatsapp_summary_updated_at) is not null then 'stale' else 'never' end,v_inserted);
    v_item_count := v_item_count + 1;
    v_insert_count := v_insert_count + v_item_inserts;
  end loop;

  update public.crm_whatsapp_local_import_runs set item_count=v_item_count,message_insert_count=v_insert_count where id=v_run.id;
  return jsonb_build_object('status','applied','run_id',v_run.id,'item_count',v_item_count,'message_insert_count',v_insert_count);
end $$;

create or replace function public.revert_crm_whatsapp_local_import(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.crm_whatsapp_local_import_runs; v_audit public.crm_whatsapp_local_import_audits; v_record public.crm_records; v_count integer:=0;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória.' using errcode='42501'; end if;
  select * into v_run from public.crm_whatsapp_local_import_runs where id=p_run_id for update;
  if not found then raise exception 'Lote não encontrado.' using errcode='22023'; end if;
  if not public.crm_has_workspace_access(v_run.workspace_id) then raise exception 'Sem acesso ao workspace.' using errcode='42501'; end if;
  if v_run.status='reverted' then return jsonb_build_object('status','already_reverted','run_id',v_run.id); end if;
  if v_run.status<>'applied' then raise exception 'Lote não pode ser revertido.' using errcode='22023'; end if;
  for v_audit in select * from public.crm_whatsapp_local_import_audits where run_id=v_run.id order by created_at desc loop
    select * into v_record from public.crm_records where id=v_audit.record_id for update;
    if coalesce(v_record.whatsapp_message_entries,'[]'::jsonb) is distinct from v_audit.after_entries then
      raise exception 'Lead alterado após este lote; reversão automática bloqueada.' using errcode='40001';
    end if;
    update public.crm_records set
      whatsapp_message_entries=v_audit.before_entries,
      whatsapp_transcript=(select string_agg(coalesce(value->>'text',''),'\n' order by coalesce(value->>'sent_at',value->>'timestamp','')) from jsonb_array_elements(v_audit.before_entries)),
      whatsapp_transcript_updated_at=now(),
      whatsapp_sync_message_count=jsonb_array_length(v_audit.before_entries),
      whatsapp_sync_new_message_count=0,
      whatsapp_analysis_status=coalesce(v_audit.before_analysis_status,'never')
    where id=v_record.id;
    v_count:=v_count+1;
  end loop;
  update public.crm_whatsapp_local_import_runs set status='reverted',reverted_at=now(),reverted_by=auth.uid() where id=v_run.id;
  return jsonb_build_object('status','reverted','run_id',v_run.id,'item_count',v_count);
end $$;

revoke all on function public.apply_crm_whatsapp_local_import(jsonb) from public,anon;
revoke all on function public.revert_crm_whatsapp_local_import(uuid) from public,anon;
grant execute on function public.apply_crm_whatsapp_local_import(jsonb) to authenticated;
grant execute on function public.revert_crm_whatsapp_local_import(uuid) to authenticated;
