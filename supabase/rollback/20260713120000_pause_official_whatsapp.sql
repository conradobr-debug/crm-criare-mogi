-- Rollback operacional não destrutivo. Preserva todas as mensagens e auditoria.
do $$ declare j bigint; begin
  for j in select jobid from cron.job where jobname in ('crm-whatsapp-process-queue','crm-whatsapp-daily-analysis','crm-whatsapp-webhook-retention') loop
    perform cron.unschedule(j);
  end loop;
end $$;

update public.crm_whatsapp_processing_jobs
set status='retry',locked_at=null,locked_by=null,available_at=now(),updated_at=now()
where status='processing';
