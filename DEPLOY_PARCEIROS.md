# Publicação — relacionamento com parceiros

## Ordem segura

1. Exportar um backup JSON pela versão atual do CRM.
2. No Supabase SQL Editor, executar
   `supabase/migrations/20260706160000_partner_relationship_system.sql`.
3. Confirmar que a tabela `crm_partner_contents` e os novos campos de
   `crm_records` foram criados.
4. Publicar `index.html`, `criare.css`, `partners.js` e `service-worker.js` no
   GitHub Pages.
5. Recarregar o CRM e confirmar que o cache ativo é a versão 16.

## Verificação da migração

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'crm_records'
  and column_name in (
    'partner_classification', 'relationship_level', 'first_visit_at',
    'cadence_type', 'cadence_active', 'interactions', 'sent_contents',
    'interest_tags', 'next_action_owner'
  );

select to_regclass('public.crm_partner_contents');

select stage, count(*)
from public.crm_records
where coalesce(record_type, 'lead') = 'specifier'
group by stage
order by stage;
```

Os nomes antigos devem aparecer migrados para `Contato iniciado`, `Parceiro
ativo` e `Adormecido`. A migração não exclui registros nem compromissos.

## Retorno seguro

Se a interface precisar voltar, restaure os quatro arquivos publicados da
versão anterior. As novas colunas e a tabela de conteúdos podem permanecer no
Supabase sem afetar a versão anterior. Não remova dados sem um backup validado.
