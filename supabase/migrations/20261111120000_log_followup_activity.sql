-- Atomic, idempotent append: retain existing notes and all recorded interactions.
create or replace function public.crm_log_followup_activity(
  p_record_id uuid, p_activity jsonb, p_next_action jsonb default null,
  p_completed_appointment_id text default null
) returns public.crm_records
language plpgsql security invoker set search_path = public
as $$
declare
  rec public.crm_records;
  activity_id uuid; performed_by uuid; happened_at timestamptz;
  next_at timestamptz; legacy_at timestamptz; activity_type text; summary text; channel text; result text;
  item jsonb; appointment jsonb; v_appointments jsonb; first_action jsonb;
begin
  if auth.uid() is null then raise exception 'Login necessário.'; end if;
  select * into rec from public.crm_records where id=p_record_id for update;
  if not found or not public.crm_has_workspace_access(rec.workspace_id) then
    raise exception 'Cadastro indisponível para este usuário.';
  end if;
  activity_id := (p_activity->>'id')::uuid;
  if activity_id is null then raise exception 'Identificador da atividade obrigatório.'; end if;
  -- Retrying the same request must not duplicate the activity or its next action.
  if exists(select 1 from jsonb_array_elements(coalesce(rec.interactions,'[]')) e where e->>'id'=activity_id::text) then return rec; end if;
  activity_type := p_activity->>'activity_type';
  summary := btrim(p_activity->>'summary');
  happened_at := (p_activity->>'at')::timestamptz;
  performed_by := coalesce((p_activity->>'performed_by')::uuid,auth.uid());
  if summary is null or length(summary)=0 or length(summary)>5000 then raise exception 'Descreva a atividade em até 5.000 caracteres.'; end if;
  if happened_at is null or not isfinite(happened_at) or happened_at>now()+interval '5 minutes' then raise exception 'Data da atividade inválida ou futura.'; end if;
  if not exists(select 1 from public.crm_workspace_members where workspace_id=rec.workspace_id and user_id=performed_by) then raise exception 'Responsável não pertence ao workspace.'; end if;
  case activity_type
    when 'phone_answered' then channel:='Ligação'; result:='Conversa realizada';
    when 'phone_unanswered' then channel:='Ligação'; result:='Sem resposta';
    when 'whatsapp' then channel:='WhatsApp'; result:='Contato registrado';
    when 'showroom' then channel:='Reunião na loja'; result:='Visita realizada';
    when 'office_visit' then channel:='Visita ao escritório'; result:='Visita realizada';
    when 'meeting' then channel:='Reunião'; result:='Conversa realizada';
    when 'presentation' then channel:='Apresentação'; result:='Apresentação realizada';
    when 'email' then channel:='E-mail'; result:='Mensagem enviada';
    when 'other' then channel:='Outro'; result:='Atividade realizada';
    else raise exception 'Tipo de atividade inválido.';
  end case;
  v_appointments := coalesce(rec.appointments,'[]');
  if p_completed_appointment_id is not null then
    if not exists(select 1 from jsonb_array_elements(v_appointments) a where a->>'id'=p_completed_appointment_id and a->>'status'='scheduled') then raise exception 'O compromisso já foi alterado. Reabra o cadastro.'; end if;
    select coalesce(jsonb_agg(case when a->>'id'=p_completed_appointment_id then a||jsonb_build_object('status','completed','completed_at',happened_at,'completed_by',performed_by) else a end),'[]') into v_appointments from jsonb_array_elements(v_appointments) a;
  end if;
  if p_next_action is not null then
    next_at := (p_next_action->>'starts_at')::timestamptz;
    if next_at is null or not isfinite(next_at) or next_at<now()-interval '1 minute' or coalesce(length(btrim(p_next_action->>'details')),0)=0 or length(p_next_action->>'details')>2000 then raise exception 'Informe a próxima ação e uma data futura válida.'; end if;
    appointment := jsonb_build_object('id',gen_random_uuid(),'starts_at',next_at,'kind','Follow-up','details',btrim(p_next_action->>'details'),'status','scheduled','owner_id',coalesce(rec.owner_id,performed_by),'participant_ids',jsonb_build_array(coalesce(rec.owner_id,performed_by)),'duration_minutes',30,'reminder_minutes',30,'source','activity_log','activity_id',activity_id);
    v_appointments := v_appointments||jsonb_build_array(appointment);
  end if;
  item := jsonb_build_object('id',activity_id,'at',happened_at,'activity_type',activity_type,'type',channel,'channel',channel,'result',result,'summary',summary,'performed_by',performed_by,'owner_id',performed_by,'recorded_by',auth.uid(),'recorded_at',now(),'source','activity_log','next_action',appointment->>'details','next_action_at',next_at,'completed_appointment_id',p_completed_appointment_id);
  -- Preserve a legacy next action when there is no appointments array yet.
  legacy_at := coalesce(rec.next_action_at, (rec.next_action + time '09:00') at time zone 'America/Sao_Paulo');
  if jsonb_array_length(coalesce(rec.appointments,'[]'))=0 and legacy_at is not null and (p_next_action is not null or p_completed_appointment_id is not null) then
    v_appointments := v_appointments||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'starts_at',legacy_at,'source','legacy_followup','kind',coalesce(rec.next_action_kind,'Follow-up'),'details',rec.next_action_details,'status','scheduled','owner_id',rec.owner_id,'duration_minutes',coalesce(rec.next_action_duration_minutes,30),'reminder_minutes',coalesce(rec.next_action_reminder_minutes,30),'event_id',rec.outlook_event_id,'web_link',rec.outlook_event_web_link,'synced_at',rec.outlook_synced_at));
  end if;
  select a into first_action from jsonb_array_elements(v_appointments) a where a->>'status'='scheduled' and nullif(a->>'starts_at','') is not null order by (a->>'starts_at')::timestamptz limit 1;
  update public.crm_records set
    interactions=coalesce(rec.interactions,'[]')||jsonb_build_array(item),
    last_contact_at=greatest(rec.last_contact_at,happened_at),
    appointments=v_appointments,
    next_action_at=case when p_next_action is not null or p_completed_appointment_id is not null then (first_action->>'starts_at')::timestamptz else rec.next_action_at end,
    next_action=case when p_next_action is not null or p_completed_appointment_id is not null then ((first_action->>'starts_at')::timestamptz at time zone 'America/Sao_Paulo')::date else rec.next_action end,
    next_action_kind=case when p_next_action is not null or p_completed_appointment_id is not null then first_action->>'kind' else rec.next_action_kind end,
    next_action_details=case when p_next_action is not null or p_completed_appointment_id is not null then first_action->>'details' else rec.next_action_details end,
    next_action_owner=case when p_next_action is not null or p_completed_appointment_id is not null then coalesce((first_action->>'owner_id')::uuid,rec.owner_id) else rec.next_action_owner end,
    next_action_duration_minutes=case when p_next_action is not null or p_completed_appointment_id is not null then coalesce((first_action->>'duration_minutes')::int,30) else rec.next_action_duration_minutes end,
    next_action_reminder_minutes=case when p_next_action is not null or p_completed_appointment_id is not null then coalesce((first_action->>'reminder_minutes')::int,30) else rec.next_action_reminder_minutes end,
    no_next_action_reason=case when first_action is not null then null else rec.no_next_action_reason end
  where id=p_record_id returning * into rec;
  return rec;
end;
$$;
revoke all on function public.crm_log_followup_activity(uuid,jsonb,jsonb,text) from public,anon;
grant execute on function public.crm_log_followup_activity(uuid,jsonb,jsonb,text) to authenticated;
