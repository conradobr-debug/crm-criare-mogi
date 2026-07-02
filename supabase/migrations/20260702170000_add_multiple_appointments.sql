alter table public.crm_records
  add column if not exists appointments jsonb not null default '[]'::jsonb;

comment on column public.crm_records.appointments is
  'Lista de compromissos do cliente, incluindo data, tipo, detalhes e vínculo com o calendário.';

update public.crm_records
set appointments = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'starts_at', next_action_at,
    'kind', coalesce(next_action_kind, 'Follow-up'),
    'details', next_action_details,
    'duration_minutes', coalesce(next_action_duration_minutes, 30),
    'reminder_minutes', coalesce(next_action_reminder_minutes, 30),
    'status', 'scheduled',
    'event_id', outlook_event_id,
    'web_link', outlook_event_web_link,
    'synced_at', outlook_synced_at
  )
)
where jsonb_array_length(appointments) = 0
  and next_action_at is not null;

create index if not exists idx_crm_records_appointments_gin
  on public.crm_records using gin (appointments);
