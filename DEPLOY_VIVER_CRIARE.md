# Publicação — Viver Criare, Pendências e calendário via Make

## Ordem segura

1. Aplicar `supabase/migrations/20260630123000_add_pending_outlook_service_brand_flow.sql`.
2. Criar o cenário gratuito na Make e configurar os segredos da Edge Function.
3. Publicar a Edge Function `outlook-calendar` com verificação JWT desativada.
4. Publicar `index.html` e `criare.css` no GitHub Pages.
5. Conectar uma única vez `criaremg@hotmail.com` dentro da Make.

## Automação gratuita na Make

Criar um cenário com estas etapas:

1. **Webhooks — Custom webhook**, recebendo o compromisso do CRM.
2. Um roteador com as rotas `create` e `update`.
3. **Microsoft 365 Calendar — Create an Event** para `operation = create`.
4. **Microsoft 365 Calendar — Update an Event** para `operation = update`.
5. Em cada rota, **Webhooks — Webhook response** devolvendo JSON com
   `event_id` e `web_link`.

A conexão Microsoft da Make deve usar a conta `criaremg@hotmail.com`. O webhook
fica somente nos segredos do Supabase; nunca deve ser incluído no JavaScript
público ou no GitHub.

## Segredos da Edge Function — Make

```text
MAKE_CALENDAR_WEBHOOK_URL=<URL do Custom webhook da Make>
MAKE_CALENDAR_WEBHOOK_SECRET=<segredo longo e aleatório>
OUTLOOK_ALLOWED_EMAIL=criaremg@hotmail.com
OUTLOOK_CONNECTOR_USER_EMAIL=conrado.br@hotmail.com
CRM_PUBLIC_URL=https://conradobr-debug.github.io/crm-criare-mogi/
```

Os segredos antigos do Microsoft Graph podem permanecer configurados como rota
de contingência. Quando os dois segredos da Make existem, a função usa a Make.

## Rota opcional pelo Microsoft Graph

No Microsoft Entra Admin Center, criar um **App registration**:

- Nome: `CRM Criare Mogi Guaçu`.
- Contas aceitas: contas Microsoft pessoais.
- Redirect URI do tipo Web:
  `https://mwpirdfcwqfmuythpawi.supabase.co/functions/v1/outlook-calendar?callback=1`
- Microsoft Graph, permissões delegadas: `User.Read` e `Calendars.ReadWrite`.
- Criar um client secret e copiar o valor apenas para os segredos do Supabase.

## Segredos opcionais do Microsoft Graph

Configurar no Supabase:

```text
MICROSOFT_CLIENT_ID=<Application client ID>
MICROSOFT_CLIENT_SECRET=<valor do client secret>
OUTLOOK_TOKEN_ENCRYPTION_KEY=<32 bytes aleatórios em base64>
OUTLOOK_ALLOWED_EMAIL=criaremg@hotmail.com
OUTLOOK_CONNECTOR_USER_EMAIL=conrado.br@hotmail.com
CRM_PUBLIC_URL=https://conradobr-debug.github.io/crm-criare-mogi/
OUTLOOK_REDIRECT_URI=https://mwpirdfcwqfmuythpawi.supabase.co/functions/v1/outlook-calendar?callback=1
```

Exemplo para gerar a chave de criptografia localmente:

```sh
openssl rand -base64 32
```

Nunca colocar o client secret, a chave de criptografia ou tokens no GitHub ou no
JavaScript público.

## Verificações

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'crm_records'
  and column_name in (
    'next_action_details', 'outlook_event_id', 'property_status',
    'professional_name', 'has_floor_plan', 'preferred_contact',
    'investment_profile', 'decision_due_at'
  );

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('crm_pending_items', 'crm_pending_attachments');
```

Teste funcional:

1. Cadastrar uma pendência com foto e confirmar que ela aparece na aba.
2. Concluir a pendência e confirmar que ela sai da lista aberta.
3. Verificar o calendário central na aba Config.
4. Criar um acompanhamento em um lead e confirmar que o evento surge diretamente
   no calendário `criaremg@hotmail.com`, com detalhes e lembrete.
5. Alterar o horário e salvar novamente; o evento existente deve ser atualizado,
   sem duplicação.

## Retorno seguro

Se a interface precisar voltar, reverta o commit do front-end. As tabelas e colunas
novas podem permanecer sem afetar a versão anterior. Para interromper apenas a
agenda, remova o segredo `MICROSOFT_CLIENT_ID` ou desconecte o calendário na aba
Config. Não remova fotos ou tabelas sem backup.
