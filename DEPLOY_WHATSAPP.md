# WhatsApp e resumo comercial

O botão de WhatsApp usa o link oficial `wa.me` e não precisa de segredo ou
serviço adicional.

O texto bruto colado pelo usuário é enviado apenas para processamento e não é
gravado. O CRM persiste somente o resumo revisável nos campos adicionados pela
migração `20260701161000_add_whatsapp_summary.sql`.

## IA opcional no nível gratuito

A função `whatsapp-summary` usa `gemini-2.5-flash-lite` quando o segredo
`GEMINI_API_KEY` está configurado no Supabase. Sem esse segredo, ou quando a
IA está indisponível, o navegador cria uma análise local de contingência e
avisa o usuário para revisar o resultado.

O nível gratuito do provedor pode usar o conteúdo para melhorar seus produtos.
Antes de ativá-lo, a empresa deve aprovar esse tratamento e orientar a equipe a
não colar documentos, senhas ou dados sensíveis.
