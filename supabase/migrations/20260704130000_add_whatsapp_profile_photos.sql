alter table public.crm_records
  add column if not exists whatsapp_channel_status text not null default 'not_checked',
  add column if not exists whatsapp_profile_photo_path text,
  add column if not exists whatsapp_profile_photo_updated_at timestamptz;

comment on column public.crm_records.whatsapp_channel_status is
  'Resultado mais recente da verificação: conversation, no_messages, not_available, error ou not_checked.';
comment on column public.crm_records.whatsapp_profile_photo_path is
  'Caminho privado da foto de perfil capturada do WhatsApp Web.';
comment on column public.crm_records.whatsapp_profile_photo_updated_at is
  'Data da última atualização bem-sucedida da foto de perfil do WhatsApp.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crm-whatsapp-avatars',
  'crm-whatsapp-avatars',
  false,
  1572864,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage'
      and tablename = 'objects' and policyname = 'crm_whatsapp_avatars_authenticated_select'
  ) then
    create policy crm_whatsapp_avatars_authenticated_select on storage.objects
      for select to authenticated using (bucket_id = 'crm-whatsapp-avatars');
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'storage'
      and tablename = 'objects' and policyname = 'crm_whatsapp_avatars_authenticated_insert'
  ) then
    create policy crm_whatsapp_avatars_authenticated_insert on storage.objects
      for insert to authenticated with check (bucket_id = 'crm-whatsapp-avatars');
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'storage'
      and tablename = 'objects' and policyname = 'crm_whatsapp_avatars_authenticated_update'
  ) then
    create policy crm_whatsapp_avatars_authenticated_update on storage.objects
      for update to authenticated using (bucket_id = 'crm-whatsapp-avatars') with check (bucket_id = 'crm-whatsapp-avatars');
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'storage'
      and tablename = 'objects' and policyname = 'crm_whatsapp_avatars_authenticated_delete'
  ) then
    create policy crm_whatsapp_avatars_authenticated_delete on storage.objects
      for delete to authenticated using (bucket_id = 'crm-whatsapp-avatars');
  end if;
end
$$;
