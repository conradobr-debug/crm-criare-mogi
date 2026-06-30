-- Garante, de forma idempotente, que alterações de crm_records sejam
-- publicadas pelo Supabase Realtime. Execute apenas após revisar o schema
-- atual do projeto de produção.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'crm_records'
  ) then
    alter publication supabase_realtime add table public.crm_records;
  end if;
end
$$;

-- Verificação manual após aplicar a migração:
-- select pubname, schemaname, tablename
-- from pg_publication_tables
-- where pubname = 'supabase_realtime'
--   and schemaname = 'public'
--   and tablename = 'crm_records';
