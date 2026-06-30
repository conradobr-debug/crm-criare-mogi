# Publicação — acompanhamento semanal, Outlook e especificadores

## Ordem segura

1. No Supabase, abra o SQL Editor e execute o conteúdo de
   `supabase/migrations/20260629230000_add_followups_quality_specifiers.sql`.
2. Confirme as verificações abaixo.
3. Publique o `index.html` no GitHub Pages.

A migração é aditiva: mantém os registros atuais e apenas acrescenta campos,
histórico de movimentações, resumos semanais e o agendamento do banco.

## Verificação no Supabase

```sql
-- Deve exibir o job às segundas, 12:00 UTC = 09:00 em São Paulo.
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'crm-weekly-lead-quality';

-- Gera um resumo imediatamente para teste (execute no SQL Editor como administrador).
select public.generate_crm_weekly_report();

select week_start, week_end, summary, generated_at
from public.crm_weekly_reports
order by week_start desc
limit 3;
```

## Teste funcional

1. Abra um lead, classifique a qualidade e salve.
2. Defina data, horário e tipo de contato; use **Salvar e agendar no Outlook**.
3. Confirme que o Outlook abriu o compromisso preenchido e salve-o.
4. Use **Registrar contato agora** e confira a movimentação em Relatórios.
5. Cadastre um registro na aba **Especificadores** e mova-o entre as etapas.

O atalho abre a tela oficial do Outlook já preenchida. A confirmação final do
compromisso continua sendo feita pelo vendedor no Outlook.

## Retorno seguro

Se for necessário voltar a interface, reverta apenas o commit do front-end. Os
novos campos podem permanecer no Supabase sem afetar a versão anterior. Para
parar somente o resumo semanal:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname = 'crm-weekly-lead-quality';
```

Não remova as tabelas ou colunas sem antes exportar um backup.
