# Extensão Criare CRM — Capturar WhatsApp

Esta extensão gratuita abre cada cliente no WhatsApp Web, captura as mensagens
carregadas e grava o histórico no CRM Criare. A atualização pode ser individual
ou em lote, sempre processando uma conversa por vez.

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

1. Mantenha o WhatsApp Web conectado no Chrome.
2. Abra o cliente e clique em **Atualizar esta conversa**; ou use **Atualizar
   WhatsApp** no topo do CRM para percorrer todos os telefones cadastrados.
3. Escolha o tipo de análise e use **Analisar automaticamente** ou o GPT da Criare.

Somente as mensagens carregadas na tela são capturadas. Para incluir mensagens
mais antigas, role a conversa para cima, aguarde o carregamento e capture novamente.

Na atualização automática, a extensão reutiliza uma única aba do WhatsApp Web,
navega pelo telefone cadastrado, aguarda o histórico correto e devolve o
resultado ao registro correspondente. O modo em lote só avança depois que o
cliente atual terminou, evitando a mistura de conversas.
Mensagens de
voz são identificadas no texto como `[Áudio sem transcrição]`; elas nunca são
silenciosamente tratadas como se fossem mensagens vazias.

## Transcrição de áudio compatível

Ao capturar, a extensão reconhece e aciona automaticamente os botões das
extensões **WhatsApp Audio Transcriber** (`wt-transcription-result`) e
**WhatsApp Parakeet Transcription** (`parakeet-wa-transcribe-result`). O texto
gerado é incluído na conversa como `[Transcrição de áudio]`.

Para não travar o CRM, a captura aguarda no máximo 12 segundos pelas transcrições.
Sem uma delas instalada, ou se o processamento ainda não terminou, o CRM mantém
o marcador `[Áudio sem transcrição]`. A transcrição continua no WhatsApp Web;
quando terminar, basta capturar novamente para incorporar o texto.

## Privacidade e limites

A extensão não envia mensagens e não acessa outras conversas. O texto passa do
WhatsApp Web para o CRM localmente no navegador. O WhatsApp pode alterar sua tela
e exigir uma atualização futura da extensão.
