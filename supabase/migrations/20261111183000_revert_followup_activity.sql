-- Revert only the function introduced for the mistaken Criare deployment.
-- Preserve all customer data, notes, interactions and appointments.
drop function if exists public.crm_log_followup_activity(uuid,jsonb,jsonb,text);
