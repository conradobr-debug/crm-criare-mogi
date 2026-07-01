# WhatsApp e resumo comercial

O botão de WhatsApp usa o link oficial `wa.me` e não precisa de segredo ou
serviço adicional.

O texto bruto colado pelo usuário é enviado apenas para processamento e não é
gravado. O CRM persiste somente o resumo revisável nos campos adicionados pela
migração `20260701161000_add_whatsapp_summary.sql`.

## Análise especializada com OpenAI

A função `whatsapp-summary` usa a Responses API quando o segredo
`OPENAI_API_KEY` está configurado no Supabase. O modelo padrão é
`gpt-5-mini` e pode ser alterado pelo segredo `OPENAI_MODEL`. Sem a chave, ou
quando a IA está indisponível, o navegador cria uma análise local de
contingência e avisa o usuário para revisar o resultado.

A requisição usa `store: false`. CPF, RG e padrões comuns de dados bancários são
ocultados antes do envio, e a equipe deve evitar colar documentos, senhas ou
endereços completos.
