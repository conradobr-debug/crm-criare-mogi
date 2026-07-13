-- Plataforma oficial WhatsApp Business para a operação Criare Mogi Guaçu.
-- Evolução aditiva: preserva crm_records, mensagens e análises existentes.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.crm_workspaces (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.crm_workspaces(id, name, slug)
values ('00000000-0000-4000-8000-000000000001', 'Criare Mogi Guaçu', 'criare-mogi-guacu')
on conflict (id) do update set name=excluded.name, slug=excluded.slug;

create table if not exists public.crm_workspace_members (
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  user_id uuid not null references public.crm_profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','manager','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

insert into public.crm_workspace_members(workspace_id, user_id, role)
select '00000000-0000-4000-8000-000000000001', id, 'admin' from public.crm_profiles
on conflict (workspace_id, user_id) do nothing;

create or replace function public.crm_has_workspace_access(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.crm_workspace_members
    where workspace_id=p_workspace_id and user_id=auth.uid()
  )
$$;
revoke all on function public.crm_has_workspace_access(uuid) from public, anon;
grant execute on function public.crm_has_workspace_access(uuid) to authenticated;

create or replace function public.crm_add_default_workspace_member()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.crm_workspace_members(workspace_id,user_id,role)
  values ('00000000-0000-4000-8000-000000000001',new.id,'member')
  on conflict do nothing;
  return new;
end $$;
revoke all on function public.crm_add_default_workspace_member() from public,anon,authenticated;
drop trigger if exists trg_crm_default_workspace_member on public.crm_profiles;
create trigger trg_crm_default_workspace_member after insert on public.crm_profiles
for each row execute function public.crm_add_default_workspace_member();

create table if not exists public.crm_whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null,
  display_phone_number text,
  verified_name text,
  coexistence_enabled boolean not null default false,
  status text not null default 'active' check(status in ('active','paused','disconnected')),
  last_webhook_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, phone_number_id)
);

create table if not exists public.crm_whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  account_id uuid not null references public.crm_whatsapp_accounts(id) on delete cascade,
  record_id uuid references public.crm_records(id) on delete set null,
  contact_wa_id text not null,
  contact_name text,
  match_status text not null default 'unmatched' check(match_status in ('matched','unmatched','ambiguous','ignored')),
  match_details jsonb not null default '{}'::jsonb,
  first_message_at timestamptz,
  last_message_at timestamptz,
  last_message_id text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_sync_at timestamptz,
  new_messages_since_analysis integer not null default 0,
  analysis_status text not null default 'never' check(analysis_status in ('never','current','stale','processing','failed')),
  analysis_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id, contact_wa_id)
);

create table if not exists public.crm_whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  account_id uuid references public.crm_whatsapp_accounts(id) on delete set null,
  external_event_key text not null unique,
  object_type text,
  signature_valid boolean not null,
  payload jsonb not null,
  headers jsonb not null default '{}'::jsonb,
  processing_status text not null default 'pending' check(processing_status in ('pending','processing','processed','failed','dead_letter')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_whatsapp_messages
  add column if not exists workspace_id uuid references public.crm_workspaces(id) on delete cascade,
  add column if not exists account_id uuid references public.crm_whatsapp_accounts(id) on delete set null,
  add column if not exists conversation_id uuid references public.crm_whatsapp_conversations(id) on delete cascade,
  add column if not exists webhook_event_id uuid references public.crm_whatsapp_webhook_events(id) on delete set null,
  add column if not exists sender_wa_id text,
  add column if not exists recipient_wa_id text,
  add column if not exists reply_to_message_id text,
  add column if not exists mime_type text,
  add column if not exists file_name text,
  add column if not exists media_size_bytes bigint,
  add column if not exists media_sha256 text,
  add column if not exists status_history jsonb not null default '[]'::jsonb,
  add column if not exists raw_message jsonb not null default '{}'::jsonb,
  add column if not exists processed_at timestamptz;

update public.crm_whatsapp_messages
set workspace_id='00000000-0000-4000-8000-000000000001'
where workspace_id is null;

create table if not exists public.crm_whatsapp_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  message_id uuid not null references public.crm_whatsapp_messages(id) on delete cascade,
  meta_media_id text not null,
  media_type text not null,
  mime_type text,
  file_name text,
  size_bytes bigint,
  sha256 text,
  storage_bucket text not null default 'crm-whatsapp-media',
  storage_path text,
  download_status text not null default 'pending' check(download_status in ('pending','downloading','stored','failed','expired')),
  transcription_status text not null default 'not_applicable' check(transcription_status in ('not_applicable','pending','processing','completed','failed')),
  transcription text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  downloaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(message_id, meta_media_id)
);

create table if not exists public.crm_whatsapp_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  job_type text not null check(job_type in ('webhook','media','transcription','analysis')),
  idempotency_key text not null,
  webhook_event_id uuid references public.crm_whatsapp_webhook_events(id) on delete cascade,
  conversation_id uuid references public.crm_whatsapp_conversations(id) on delete cascade,
  record_id uuid references public.crm_records(id) on delete cascade,
  message_id uuid references public.crm_whatsapp_messages(id) on delete cascade,
  media_id uuid references public.crm_whatsapp_media(id) on delete cascade,
  priority integer not null default 100,
  status text not null default 'pending' check(status in ('pending','processing','completed','retry','dead_letter')),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(job_type,idempotency_key)
);

create table if not exists public.crm_whatsapp_analysis_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  conversation_id uuid not null references public.crm_whatsapp_conversations(id) on delete cascade,
  record_id uuid not null references public.crm_records(id) on delete cascade,
  triggered_by text not null check(triggered_by in ('manual','daily','initial','retry')),
  requested_by uuid references public.crm_profiles(id) on delete set null,
  status text not null check(status in ('processing','completed','failed')),
  hard_boss text,
  full_analysis text,
  structured_analysis jsonb not null default '{}'::jsonb,
  model text,
  previous_hard_boss text,
  previous_full_analysis text,
  first_message_at timestamptz,
  last_message_at timestamptz,
  last_message_id text,
  message_count integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.crm_records
  add column if not exists whatsapp_official_last_sync_at timestamptz,
  add column if not exists whatsapp_official_sync_error text,
  add column if not exists whatsapp_analysis_status text not null default 'never',
  add column if not exists whatsapp_analysis_last_message_id text,
  add column if not exists whatsapp_analysis_message_count integer not null default 0,
  add column if not exists whatsapp_analysis_structured jsonb not null default '{}'::jsonb;

create index if not exists idx_crm_wa_accounts_workspace on public.crm_whatsapp_accounts(workspace_id,status);
create index if not exists idx_crm_wa_conversations_record on public.crm_whatsapp_conversations(workspace_id,record_id,last_message_at desc);
create index if not exists idx_crm_wa_conversations_stale on public.crm_whatsapp_conversations(workspace_id,analysis_status,last_message_at);
create index if not exists idx_crm_wa_events_queue on public.crm_whatsapp_webhook_events(processing_status,next_attempt_at);
create index if not exists idx_crm_wa_messages_conversation_time on public.crm_whatsapp_messages(conversation_id,message_timestamp,id);
create index if not exists idx_crm_wa_messages_workspace_time on public.crm_whatsapp_messages(workspace_id,message_timestamp desc);
create index if not exists idx_crm_wa_media_queue on public.crm_whatsapp_media(download_status,next_attempt_at);
create index if not exists idx_crm_wa_jobs_claim on public.crm_whatsapp_processing_jobs(status,available_at,priority,created_at);
create index if not exists idx_crm_wa_analysis_record on public.crm_whatsapp_analysis_history(record_id,created_at desc);

create or replace function public.crm_mark_whatsapp_conversation_new_message()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.conversation_id is not null then
    update public.crm_whatsapp_conversations set
      first_message_at=coalesce(first_message_at,new.message_timestamp),last_message_at=new.message_timestamp,
      last_message_id=new.meta_message_id,last_inbound_at=case when new.direction='inbound' then new.message_timestamp else last_inbound_at end,
      last_outbound_at=case when new.direction='outbound' then new.message_timestamp else last_outbound_at end,
      last_sync_at=now(),new_messages_since_analysis=new_messages_since_analysis+1,
      analysis_status=case when analysis_status='never' then 'never' else 'stale' end,updated_at=now()
    where id=new.conversation_id;
  end if;
  return new;
end $$;
revoke all on function public.crm_mark_whatsapp_conversation_new_message() from public,anon,authenticated;
drop trigger if exists trg_crm_whatsapp_message_received on public.crm_whatsapp_messages;
create trigger trg_crm_whatsapp_message_received after insert on public.crm_whatsapp_messages
for each row execute function public.crm_mark_whatsapp_conversation_new_message();

create or replace function public.link_crm_whatsapp_messages()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_phone text; v_count integer;
begin
  v_phone:=regexp_replace(coalesce(new.phone,''),'[^0-9]','','g');
  if v_phone='' then return new; end if;
  select count(*) into v_count from public.crm_records where regexp_replace(coalesce(phone,''),'[^0-9]','','g')=v_phone;
  if v_count=1 then
    update public.crm_whatsapp_conversations set record_id=new.id,match_status='matched',match_details=jsonb_build_object('method','normalized_phone','count',1),updated_at=now() where contact_wa_id=v_phone;
    update public.crm_whatsapp_messages set record_id=new.id,updated_at=now() where contact_wa_id=v_phone and record_id is distinct from new.id;
  else
    update public.crm_whatsapp_conversations set record_id=null,match_status='ambiguous',match_details=jsonb_build_object('method','normalized_phone','count',v_count),updated_at=now() where contact_wa_id=v_phone;
  end if;
  return new;
end $$;
revoke all on function public.link_crm_whatsapp_messages() from public,anon,authenticated;
grant execute on function public.link_crm_whatsapp_messages() to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('crm-whatsapp-media','crm-whatsapp-media',false,26214400,array[
  'audio/aac','audio/amr','audio/mpeg','audio/mp4','audio/ogg','audio/opus',
  'image/jpeg','image/png','image/webp','video/mp4','video/3gpp',
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'
]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.crm_workspaces enable row level security;
alter table public.crm_workspace_members enable row level security;
alter table public.crm_whatsapp_accounts enable row level security;
alter table public.crm_whatsapp_conversations enable row level security;
alter table public.crm_whatsapp_webhook_events enable row level security;
alter table public.crm_whatsapp_media enable row level security;
alter table public.crm_whatsapp_processing_jobs enable row level security;
alter table public.crm_whatsapp_analysis_history enable row level security;

grant select on public.crm_workspaces,public.crm_workspace_members,public.crm_whatsapp_accounts,
  public.crm_whatsapp_conversations,public.crm_whatsapp_media,public.crm_whatsapp_analysis_history to authenticated;
grant select on public.crm_whatsapp_messages to authenticated;

do $$ declare t text; begin
  foreach t in array array['crm_workspaces','crm_workspace_members','crm_whatsapp_accounts','crm_whatsapp_conversations','crm_whatsapp_media','crm_whatsapp_analysis_history'] loop
    execute format('drop policy if exists %I on public.%I','workspace_member_select',t);
    if t='crm_workspaces' then
      execute 'create policy workspace_member_select on public.crm_workspaces for select to authenticated using (public.crm_has_workspace_access(id))';
    elsif t='crm_workspace_members' then
      execute 'create policy workspace_member_select on public.crm_workspace_members for select to authenticated using (public.crm_has_workspace_access(workspace_id))';
    else
      execute format('create policy workspace_member_select on public.%I for select to authenticated using (public.crm_has_workspace_access(workspace_id))',t);
    end if;
  end loop;
end $$;

drop policy if exists crm_whatsapp_messages_authenticated_select on public.crm_whatsapp_messages;
create policy crm_whatsapp_messages_workspace_select on public.crm_whatsapp_messages
for select to authenticated using (workspace_id is not null and public.crm_has_workspace_access(workspace_id));

drop policy if exists crm_whatsapp_media_member_select on storage.objects;
create policy crm_whatsapp_media_member_select on storage.objects for select to authenticated using (
  bucket_id='crm-whatsapp-media' and public.crm_has_workspace_access(((storage.foldername(name))[1])::uuid)
);

create or replace function public.claim_crm_whatsapp_jobs(p_worker text,p_limit integer default 10)
returns setof public.crm_whatsapp_processing_jobs language plpgsql security definer set search_path=public as $$
begin
  return query
  with candidates as (
    select id from public.crm_whatsapp_processing_jobs
    where status in ('pending','retry') and available_at<=now()
      and (locked_at is null or locked_at<now()-interval '10 minutes')
    order by priority asc,created_at asc for update skip locked limit greatest(1,least(p_limit,25))
  )
  update public.crm_whatsapp_processing_jobs j set status='processing',locked_at=now(),locked_by=p_worker,
    attempts=j.attempts+1,updated_at=now()
  from candidates c where j.id=c.id returning j.*;
end $$;
revoke all on function public.claim_crm_whatsapp_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.claim_crm_whatsapp_jobs(text,integer) to service_role;

create or replace function public.queue_daily_crm_whatsapp_analyses()
returns integer language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  insert into public.crm_whatsapp_processing_jobs(workspace_id,job_type,idempotency_key,conversation_id,record_id,priority,payload)
  select c.workspace_id,'analysis','daily:'||c.id||':'||coalesce(c.last_message_id,'none'),c.id,c.record_id,50,
    jsonb_build_object('triggered_by','daily')
  from public.crm_whatsapp_conversations c
  where c.record_id is not null and c.last_message_id is not null
    and (c.analysis_status in ('never','stale','failed') or c.new_messages_since_analysis>0)
  on conflict(job_type,idempotency_key) do nothing;
  get diagnostics n=row_count;
  return n;
end $$;
revoke all on function public.queue_daily_crm_whatsapp_analyses() from public,anon,authenticated;

do $$ declare j bigint; begin
  select jobid into j from cron.job where jobname='crm-whatsapp-daily-analysis';
  if j is not null then perform cron.unschedule(j); end if;
  perform cron.schedule('crm-whatsapp-daily-analysis','0 12 * * *','select public.queue_daily_crm_whatsapp_analyses()');
end $$;

create or replace function public.configure_crm_whatsapp_processor(p_project_url text,p_secret text)
returns void language plpgsql security definer set search_path=public,vault,cron,net as $$
declare j bigint;
begin
  if p_project_url !~ '^https://[a-z0-9-]+\.supabase\.co$' or length(p_secret)<32 then raise exception 'configuração inválida'; end if;
  perform vault.create_secret(p_project_url,'crm_whatsapp_project_url','URL do projeto para o worker WhatsApp');
  perform vault.create_secret(p_secret,'crm_whatsapp_processor_secret','Segredo interno do worker WhatsApp');
  select jobid into j from cron.job where jobname='crm-whatsapp-process-queue';
  if j is not null then perform cron.unschedule(j); end if;
  perform cron.schedule('crm-whatsapp-process-queue','* * * * *',$cmd$
    select net.http_post(
      url:=(select decrypted_secret from vault.decrypted_secrets where name='crm_whatsapp_project_url' order by created_at desc limit 1)||'/functions/v1/whatsapp-processor',
      headers:=jsonb_build_object('content-type','application/json','x-crm-processor-secret',(select decrypted_secret from vault.decrypted_secrets where name='crm_whatsapp_processor_secret' order by created_at desc limit 1)),
      body:='{"action":"process_queue","limit":20}'::jsonb,timeout_milliseconds:=50000)
  $cmd$);
end $$;
revoke all on function public.configure_crm_whatsapp_processor(text,text) from public,anon,authenticated;
grant execute on function public.configure_crm_whatsapp_processor(text,text) to service_role;

create or replace function public.redact_old_crm_whatsapp_webhooks()
returns integer language plpgsql security definer set search_path=public as $$
declare n integer; begin
  update public.crm_whatsapp_webhook_events set payload='{}'::jsonb,headers='{}'::jsonb,updated_at=now()
  where received_at<now()-interval '180 days' and processing_status='processed' and payload<>'{}'::jsonb;
  get diagnostics n=row_count; return n;
end $$;
revoke all on function public.redact_old_crm_whatsapp_webhooks() from public,anon,authenticated;
do $$ declare j bigint; begin
  select jobid into j from cron.job where jobname='crm-whatsapp-webhook-retention';
  if j is not null then perform cron.unschedule(j); end if;
  perform cron.schedule('crm-whatsapp-webhook-retention','30 3 * * 0','select public.redact_old_crm_whatsapp_webhooks()');
end $$;

comment on table public.crm_whatsapp_webhook_events is 'Eventos brutos oficiais Meta; conteúdo retido por 180 dias e depois anonimizado.';
comment on table public.crm_whatsapp_processing_jobs is 'Fila idempotente com retry, trava e dead-letter para webhook, mídia, transcrição e análise.';
