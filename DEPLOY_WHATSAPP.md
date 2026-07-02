# WhatsApp e resumo comercial

O botão de WhatsApp usa o link oficial `wa.me` e não precisa de segredo ou
serviço adicional.

O texto bruto colado pelo usuário é enviado apenas para processamento e não é
gravado. O CRM persiste somente o resumo revisável nos campos adicionados pela
migração `20260701161000_add_whatsapp_summary.sql`.

## Análise especializada com ChatGPT e Gemini

A função `whatsapp-summary` tenta primeiro a Responses API quando o segredo
`OPENAI_API_KEY` está configurado no Supabase. O modelo padrão é `gpt-5-mini`
e pode ser alterado pelo segredo `OPENAI_MODEL`.

Quando a OpenAI não está configurada ou está sem saldo, a função usa o Gemini
com os segredos `GEMINI_API_KEY` e `GEMINI_MODEL`. O modelo gratuito padrão é
`gemini-2.5-flash-lite`. Se os dois provedores estiverem indisponíveis, o
navegador cria uma análise local de contingência e avisa o usuário para revisar
o resultado.

A requisição usa `store: false`. CPF, RG e padrões comuns de dados bancários são
ocultados antes do envio, e a equipe deve evitar colar documentos, senhas ou
endereços completos.

No plano gratuito do Gemini, o Google informa que os dados enviados podem ser
usados para melhorar seus produtos. Por isso, os padrões sensíveis continuam
sendo ocultados antes do envio e a conversa bruta não é armazenada pelo CRM.
