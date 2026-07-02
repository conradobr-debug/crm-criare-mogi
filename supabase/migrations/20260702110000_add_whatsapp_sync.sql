-- Sincronização oficial do WhatsApp Business com o CRM.
-- As mensagens são gravadas pelo webhook (service role) e ficam disponíveis
-- somente para usuários autenticados do CRM.

create table if not exists public.crm_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  meta_message_id text not null unique,
  waba_id text null,
  phone_number_id text null,
  record_id uuid null references public.crm_records(id) on delete set null,
  contact_wa_id text not null,
  contact_name text null,
  direction text not null,
  message_type text not null default 'text',
  body text null,
  media_id text null,
  source text not null default 'cloud_api',
  status text null,
  message_timestamp timestamptz not null,
  status_timestamp timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_whatsapp_messages_direction_check
    check (direction in ('inbound', 'outbound'))
);

create index if not exists idx_crm_whatsapp_messages_record_time
  on public.crm_whatsapp_messages(record_id, message_timestamp desc);

create index if not exists idx_crm_whatsapp_messages_contact_time
  on public.crm_whatsapp_messages(contact_wa_id, message_timestamp desc);

create index if not exists idx_crm_whatsapp_messages_phone_time
  on public.crm_whatsapp_messages(phone_number_id, message_timestamp desc);

alter table public.crm_whatsapp_messages enable row level security;
grant select on public.crm_whatsapp_messages to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'crm_whatsapp_messages'
      and policyname = 'crm_whatsapp_messages_authenticated_select'
  ) then
    create policy crm_whatsapp_messages_authenticated_select
      on public.crm_whatsapp_messages
      for select to authenticated
      using (auth.uid() is not null);
  end if;
end
$$;

create or replace function public.link_crm_whatsapp_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
begin
  v_phone := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');
  if v_phone <> '' then
    update public.crm_whatsapp_messages
       set record_id = new.id,
           updated_at = now()
     where contact_wa_id = v_phone
       and record_id is distinct from new.id;
  end if;
  return new;
end
$$;

revoke all on function public.link_crm_whatsapp_messages() from public, anon, authenticated;

drop trigger if exists trg_link_crm_whatsapp_messages on public.crm_records;
create trigger trg_link_crm_whatsapp_messages
after insert or update of phone on public.crm_records
for each row execute function public.link_crm_whatsapp_messages();

update public.crm_whatsapp_messages m
   set record_id = r.id,
       updated_at = now()
  from public.crm_records r
 where m.record_id is null
   and m.contact_wa_id = regexp_replace(coalesce(r.phone, ''), '[^0-9]', '', 'g');

comment on table public.crm_whatsapp_messages is
  'Mensagens sincronizadas pelo webhook oficial da Plataforma do WhatsApp Business.';

