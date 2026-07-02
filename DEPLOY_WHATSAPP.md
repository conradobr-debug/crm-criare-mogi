# WhatsApp e resumo comercial

O botão de WhatsApp usa o link oficial `wa.me` e não precisa de segredo ou
serviço adicional.

## Uso manual do GPT personalizado

O botão `Copiar e abrir meu GPT` prepara a conversa com o contexto do cliente,
o modo de análise e o formato de retorno esperado. O texto é copiado para a
área de transferência e o GPT personalizado da Criare é aberto em uma nova aba.
O usuário cola e envia a mensagem usando sua própria sessão do ChatGPT, sem
consumir a API do CRM.

Ao copiar a resposta do ChatGPT, o botão `Importar resposta copiada` preenche o
resumo, a qualidade do lead e o próximo passo quando encontra o bloco JSON
solicitado. Se o GPT devolver somente texto, a resposta completa é colocada no
campo de resumo para revisão. O navegador pode exigir autorização para ler a
área de transferência; nesse caso, o usuário pode colar a resposta diretamente
no campo de resumo.

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
