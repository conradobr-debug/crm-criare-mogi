# Ativação da WhatsApp Business Platform oficial

## O que já está implementado

Webhook oficial com validação `X-Hub-Signature-256`, armazenamento bruto, fila idempotente, retry/dead-letter, mensagens e status, contas, conversas, associação segura, mídias privadas, transcrição de áudio, timeline, análise manual, análise diária, histórico de análises, RLS e retenção.

Callback do webhook:

`https://mwpirdfcwqfmuythpawi.supabase.co/functions/v1/whatsapp-webhook`

## Ações externas na Meta

1. No Meta App correto, habilitar o produto WhatsApp e vincular a WABA da Criare.
2. Confirmar que o número da loja é elegível para **WhatsApp Business App Coexistence** e concluir o onboarding oficial. Número adicionado: `+55 19 99164-7787`; verificação do número e ativação do Coexistence: `PENDENTE DE CONFIRMAÇÃO`.
3. Configurar o callback acima e usar o valor já cadastrado no secret `WHATSAPP_VERIFY_TOKEN`.
4. Assinar pelo menos o campo `messages`. Para Coexistence, habilitar também os campos de eco/histórico que o painel disponibilizar para a conta. Os nomes exibidos e a disponibilidade na WABA são `PENDENTE DE CONFIRMAÇÃO` até o onboarding.
5. Identificadores confirmados no WhatsApp Manager em 13/07/2026: WABA ID `2069190594483653`, Phone Number ID `1181271645073826` e número `+55 19 99164-7787`. Nome de exibição `Criare Mogi Guaçu`: em análise.
6. Garantir um token de System User de longa duração com as permissões exigidas pela conta, incluindo `whatsapp_business_management` e `whatsapp_business_messaging`. O secret `WHATSAPP_ACCESS_TOKEN` já existe, mas validade, escopos e vínculo com a WABA são `PENDENTE DE CONFIRMAÇÃO`.
7. Confirmar no Meta App que o App Secret usado no secret `META_APP_SECRET` pertence ao mesmo aplicativo do webhook.
8. Templates só são necessários para conversas iniciadas pela empresa fora da janela permitida. O CRM desta entrega não envia mensagens nem cria templates.

## Secrets Supabase

Obrigatórios: `META_APP_SECRET`, `META_GRAPH_API_VERSION`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PROCESSOR_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL`. O frontend não recebe nenhum deles.

`META_GRAPH_API_VERSION` deve ser revisado conforme o ciclo oficial de versões da Meta. Versão exibida e escolhida para produção em 13/07/2026: `v25.0`.

## Rotinas

- Fila: executada a cada minuto pela Edge Function `whatsapp-processor` via `pg_cron` + `pg_net` + Vault.
- Análise diária: `0 12 * * *` em UTC, equivalente a 09:00 em America/Sao_Paulo. Alterar o cron `crm-whatsapp-daily-analysis` para mudar o horário.
- Retenção: domingo 03:30 UTC; payloads processados com mais de 180 dias são anonimizados.

## Diagnóstico

- Eventos: `crm_whatsapp_webhook_events`.
- Fila/retry/dead-letter: `crm_whatsapp_processing_jobs`.
- Contatos não associados: `crm_whatsapp_conversations.match_status in ('unmatched','ambiguous')`.
- Histórico de análise: `crm_whatsapp_analysis_history`.
- Execuções do cron: `cron.job_run_details`.

## Limitação real de histórico

A Cloud API entrega eventos a partir da inscrição. Mensagens anteriores só entram quando a Meta disponibiliza sincronização de histórico no onboarding de Coexistence para a conta. O CRM não usa WhatsApp Web, QR Code nem API não oficial para preencher lacunas.

## Rollback seguro

1. Reverter o commit da interface para retirar timeline/botão novos.
2. Pausar os jobs `crm-whatsapp-process-queue`, `crm-whatsapp-daily-analysis` e `crm-whatsapp-webhook-retention`.
3. Restaurar a versão anterior das Edge Functions `whatsapp-webhook` e `whatsapp-summary` pelo histórico Git.
4. Não apagar as tabelas novas: elas são aditivas e preservam auditoria. Uma remoção definitiva só deve ocorrer depois de backup e validação LGPD.
5. Na Meta, remover temporariamente a assinatura do webhook se for necessário interromper o recebimento.
