# Extensão Criare CRM — Capturar WhatsApp

Esta extensão gratuita captura as mensagens já carregadas na conversa aberta no
WhatsApp Web e envia o texto para o campo de análise do CRM Criare.

## Instalação única no Chrome

1. Abra `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Escolha esta pasta `whatsapp-crm-extension`.
5. Atualize as abas do CRM e do WhatsApp Web.

Ao clicar no ícone da extensão, será exibido um guia com atalhos para abrir o
CRM e o WhatsApp Web. A captura é iniciada pelo botão dentro do cliente no CRM,
para que o histórico seja associado à pessoa correta.

## Uso

1. Abra o cliente no CRM.
2. Clique em **Abrir conversa** e deixe a aba do WhatsApp Web carregar o cliente.
3. Volte ao CRM e clique em **Capturar do WhatsApp Web**.
4. Escolha o tipo de análise e use **Analisar automaticamente** ou o GPT da Criare.

Somente as mensagens carregadas na tela são capturadas. Para incluir mensagens
mais antigas, role a conversa para cima, aguarde o carregamento e capture novamente.

Ao abrir a conversa, a extensão reutiliza a aba mais recente do WhatsApp Web —
ou cria uma quando não existe — e registra essa aba para o telefone do cliente.
A captura aceita somente essa aba. Se o usuário não clicar em **Abrir
conversa** naquele cliente primeiro, a captura é recusada; nenhuma outra aba ou
conversa anterior é reutilizada.
Mensagens de
voz são identificadas no texto como `[Áudio sem transcrição]`; elas nunca são
silenciosamente tratadas como se fossem mensagens vazias.

## Transcrição de áudio compatível

Ao capturar, a extensão reconhece e aciona automaticamente os botões das
extensões **WhatsApp Audio Transcriber** (`wt-transcription-result`) e
**WhatsApp Parakeet Transcription** (`parakeet-wa-transcribe-result`). O texto
gerado é incluído na conversa como `[Transcrição de áudio]`.

Sem uma delas instalada, ou se a transcrição falhar, o CRM mantém o marcador
`[Áudio sem transcrição]`. A primeira carga do modelo Parakeet pode demorar e,
nesse caso, basta aguardar a conclusão no WhatsApp Web e capturar novamente.

## Privacidade e limites

A extensão não envia mensagens e não acessa outras conversas. O texto passa do
WhatsApp Web para o CRM localmente no navegador. O WhatsApp pode alterar sua tela
e exigir uma atualização futura da extensão.
