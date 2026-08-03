-- Retira a automação oficial antiga do WhatsApp.
-- O fluxo atual é local: CRM -> fila -> extensão -> GPT -> importação em lote.
do $$
declare
  job record;
begin
  for job in
    select jobid
    from cron.job
    where jobname in (
      'crm-whatsapp-process-queue',
      'crm-whatsapp-daily-analysis',
      'crm-whatsapp-webhook-retention'
    )
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end
$$;

comment on table public.crm_whatsapp_conversations is
  'Estrutura legada preservada temporariamente apenas para auditoria e reversao. O fluxo ativo nao grava conversas no Supabase.';

