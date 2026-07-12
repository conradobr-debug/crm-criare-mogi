# WhatsApp e resumo comercial

## Captura gratuita pelo WhatsApp Web

A pasta `whatsapp-crm-extension` contém uma extensão local do Chrome que captura
as mensagens já carregadas na conversa aberta no WhatsApp Web. Ela não envia
mensagens, não desconecta o WhatsApp Business do celular e não possui mensalidade.
Ao clicar em Abrir conversa, a extensão reutiliza a aba mais recente do WhatsApp
Web (ou cria uma se necessário) e registra essa aba para aquele telefone. A
captura aceita somente essa aba e recusa o processo se o usuário não
abrir a conversa pelo CRM primeiro. Áudios são sinalizados quando ainda não há
transcrição disponível.

A captura reconhece os resultados inseridos pelas extensões WhatsApp Audio
Transcriber e WhatsApp Parakeet Transcription. Quando os botões dessas extensões
estão disponíveis, o CRM solicita a transcrição dos áudios carregados antes de
montar o texto da conversa. A espera é limitada a 12 segundos; transcrições mais
demoradas continuam no WhatsApp Web e entram numa captura posterior.

Para instalar, abra `chrome://extensions`, ative o modo do desenvolvedor, clique
em **Carregar sem compactação** e selecione a pasta `whatsapp-crm-extension`.
Depois, atualize as abas do CRM e do WhatsApp Web.

A captura depende da estrutura visual do WhatsApp Web e pode precisar de ajuste
se o WhatsApp alterar a página. A versão 2.0.0 percorre o histórico virtualizado
automaticamente, com limite de segurança de 5.000 mensagens/50 segundos, e
registra no lead se conseguiu alcançar o início da conversa.

O botão de WhatsApp usa o link oficial `wa.me` e não precisa de segredo ou
serviço adicional.

## Uso manual do GPT personalizado

O botão `Atualizar e abrir GPT Criare` atualiza primeiro a conversa, prepara o
contexto do cliente e abre o GPT personalizado da Criare em uma nova aba. O
pedido fica copiado para ser colado e enviado na sessão do ChatGPT do usuário.
O usuário cola e envia a mensagem usando sua própria sessão do ChatGPT, sem
consumir a API do CRM.

Ao copiar a resposta do ChatGPT, o botão `Salvar análise copiada` grava sem outro
clique o parágrafo final **Chefe Duro**, a análise completa, a qualidade do lead
e o próximo passo quando encontra o bloco JSON solicitado. O Chefe Duro fica
fixado no cadastro e a resposta integral abre em `Ver análise completa`. Se o
navegador bloquear a área de transferência, o CRM abre um campo de colagem.

O CRM persiste separadamente o Chefe Duro e a análise integral nos campos da
migração `20260712190000_add_whatsapp_analysis_detail.sql`. A conversa capturada
permanece protegida pelo acesso do CRM.

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
