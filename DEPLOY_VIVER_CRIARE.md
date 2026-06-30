# Publicação — Viver Criare, Pendências e Outlook direto

## Ordem segura

1. Aplicar `supabase/migrations/20260630123000_add_pending_outlook_service_brand_flow.sql`.
2. Criar a aplicação Microsoft e configurar os segredos da Edge Function.
3. Publicar a Edge Function `outlook-calendar` com verificação JWT desativada.
4. Publicar `index.html` e `criare.css` no GitHub Pages.
5. Na aba **Config**, conectar uma única vez `criaremg@hotmail.com`.

## Aplicação Microsoft

No Microsoft Entra Admin Center, criar um **App registration**:

- Nome: `CRM Criare Mogi Guaçu`.
- Contas aceitas: contas Microsoft pessoais.
- Redirect URI do tipo Web:
  `https://mwpirdfcwqfmuythpawi.supabase.co/functions/v1/outlook-calendar?callback=1`
- Microsoft Graph, permissões delegadas: `User.Read` e `Calendars.ReadWrite`.
- Criar um client secret e copiar o valor apenas para os segredos do Supabase.

## Segredos da Edge Function

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
3. Conectar o Outlook na aba Config.
4. Criar um acompanhamento em um lead e confirmar que o evento surge diretamente
   no calendário `criaremg@hotmail.com`, com detalhes e lembrete.
5. Alterar o horário e salvar novamente; o evento existente deve ser atualizado,
   sem duplicação.

## Retorno seguro

Se a interface precisar voltar, reverta o commit do front-end. As tabelas e colunas
novas podem permanecer sem afetar a versão anterior. Para interromper apenas a
agenda, remova o segredo `MICROSOFT_CLIENT_ID` ou desconecte o calendário na aba
Config. Não remova fotos ou tabelas sem backup.
