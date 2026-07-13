# Arquitetura encontrada e evolução oficial do WhatsApp

## Arquitetura encontrada

O CRM Criare é uma aplicação estática publicada no GitHub Pages. O frontend principal está em `index.html`, a área de parceiros em `partners.js` e o estilo em `criare.css`. Não há bundler, framework, repository layer, mappers ou modo mock. O acesso a dados era feito diretamente pelo cliente Supabase no frontend.

A autenticação usa Supabase Auth. `crm_profiles` representa os dois usuários atuais. Antes desta evolução não havia entidade de workspace: todos os usuários autenticados enxergavam a mesma operação. Leads, clientes fechados e parceiros são variações de `crm_records`; oportunidades e projetos não existem como tabelas separadas. Tarefas ficam em `crm_pending_items`, compromissos em `crm_records.appointments`, notas em `crm_records.notes` e eventos em `crm_record_events`.

O calendário existente usa a Edge Function `outlook-calendar`, Microsoft Graph ou Make, e não foi alterado. O WhatsApp já possuía `crm_whatsapp_messages`, um webhook inicial e análise via `whatsapp-summary`. “Chefe Duro” fica em `crm_records.whatsapp_analysis_hard_boss`; a análise completa fica em `whatsapp_analysis_full` e abre no modal existente.

## Decisões incrementais

- A fonte operacional passa a ser exclusivamente a WhatsApp Business Platform/Cloud API.
- A camada existente não foi reconstruída. Foi criado apenas `whatsapp-data-service.js`, um serviço focal para evitar novas chamadas Supabase espalhadas na interface.
- Foi criado o workspace único `Criare Mogi Guaçu` e associação dos perfis atuais. As novas tabelas são isoladas por `workspace_id` e RLS.
- Associação automática usa somente telefone normalizado com exatamente um resultado. Zero resultados ficam `unmatched`; mais de um fica `ambiguous`.
- O webhook apenas valida, persiste e enfileira. Processamento, mídia, transcrição e análise ocorrem fora do request.
- Mensagens são idempotentes por `meta_message_id`; eventos por SHA-256 do corpo; jobs por tipo + chave de idempotência.
- Mídias ficam no bucket privado `crm-whatsapp-media`. URLs originais da Meta não são persistidas.
- A análise anterior é copiada para o histórico antes da atualização e nunca é apagada em falhas.
- Eventos brutos processados são retidos por 180 dias e depois têm payload e headers anonimizados, preservando metadados de auditoria.

## Riscos de regressão controlados

- O schema é aditivo e preserva colunas e mensagens antigas.
- O Outlook/Google Calendar citado no requisito não existe neste CRM; a integração real é Outlook e permaneceu intocada.
- Não foi criada uma implementação mock fictícia, porque o projeto real não possui modo mock.
- O histórico anterior à ativação oficial depende do recurso de histórico/Coexistence disponibilizado pela Meta e não pode ser reconstruído pelo CRM.
