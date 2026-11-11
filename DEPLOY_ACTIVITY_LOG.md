# Criare Mogi Guaçu — histórico de atividades e próxima ação

Alteração de 11/11/2026, baseada na versão publicada `ccbebfa8235f6013f239f0f235b8956d538aa75d`.

## Comportamento

- Leads/clientes e Professional Partners passam a compartilhar o botão **Registrar atividade**. Cada entrada tem tipo, data da realização, descrição, pessoa que realizou, usuário que registrou e data da gravação.
- Atalhos para ligação atendida, ligação não atendida e visita ao showroom. Outros tipos ficam no seletor.
- A próxima ação pode ser adicionada junto com a atividade, com descrição, data e horário. Um compromisso existente pode ser explicitamente concluído. O responsável pelo cadastro não é alterado pelo autor do contato.
- Na ficha, descrição e data da próxima ação ficam visíveis. Duração, lembrete, tipo e participantes permanecem em **Mais opções de agenda**. A inclusão na ficha exige o botão **Salvar**; o formulário de atividade grava imediatamente.
- O relatório **Atividades realizadas por dia** usa `interactions.at`, no fuso `America/Sao_Paulo`. Tem filtros de período, autor, tipo de atividade e tipo de cadastro, agrupamentos por dia/pessoa/tipo e exportação CSV.
- O relatório novo respeita o acesso existente à aba Relatórios (administrador). Notas livres, mensagens, compromissos agendados e eventos de mudança de etapa não contam como atividades realizadas.
- Notas existentes ficam em **Notas anteriores e contexto geral**. Não há conversão automática de texto em fatos/datagens. Entradas estruturadas anteriores com data válida continuam disponíveis; autor ou data ausentes são `PENDENTE DE CONFIRMAÇÃO`.

## Persistência

A migração `20261111120000_log_followup_activity.sql` adiciona apenas a RPC `crm_log_followup_activity`. Não atualiza nem apaga cadastros na implantação. A função usa as permissões do usuário, verifica a associação ao workspace, trava a linha e acrescenta uma entrada ao JSON existente. Um UUID por tentativa lógica torna as repetições idempotentes. Atividade e próxima ação são gravadas na mesma transação. Datas futuras de atividade, autores fora do workspace e próximos passos incompletos são rejeitados. Registros retroativos não recuam `last_contact_at`.

As alterações de interface são carregadas depois de `partners.js`. Os seletores de título de parceiros foram corrigidos para o HTML atual, evitando erro ao abrir a ficha. O cache do aplicativo tem versão nova.

## Validação

- `node --test tests/*.test.mjs`: 176 testes aprovados, incluindo os 170 testes anteriores.
- `tests/activity-log.database.mjs`: execução da migração em PostgreSQL local via PGlite; gravação, repetição sem duplicidade, preservação de notas, atribuição, datas retroativas, conclusão e preservação de compromissos legados, rejeição de entradas inválidas e autorização.
- `tests/activity-log.browser.mjs`: Chrome isolado com dados fictícios e requisições externas bloqueadas; leads, parceiros, manutenção de notas/rascunhos, falha e repetição, agendamento pela ficha, filtros, CSV, desktop/celular e ausência de erros de página. O navegador é fechado ao terminar.
- Os testes adicionais de banco e navegador usam módulos externos somente no ambiente de desenvolvimento (`PGLITE_MODULE` e `PLAYWRIGHT_MODULE`); nenhuma dependência nova no navegador do usuário.

## Publicação e reversão

Aplicar a migração no projeto Supabase do CRM antes de publicar os arquivos estáticos no GitHub Pages. Conferir os arquivos servidos e a versão do cache após a implantação.

Para reverter a interface, reverter o commit no GitHub e publicar novamente. A RPC pode permanecer instalada sem uso; as atividades já gravadas permanecem em `interactions`. Não apagar logs nem reverter dados dos clientes.
