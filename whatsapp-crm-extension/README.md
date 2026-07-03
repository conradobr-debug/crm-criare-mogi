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
2. Clique em **Abrir conversa** e deixe a conversa carregar no WhatsApp Web.
3. Volte ao CRM e clique em **Capturar do WhatsApp Web**.
4. Escolha o tipo de análise e use **Analisar automaticamente** ou o GPT da Criare.

Somente as mensagens carregadas na tela são capturadas. Para incluir mensagens
mais antigas, role a conversa para cima, aguarde o carregamento e capture novamente.

Antes da captura, a extensão compara o nome ou telefone da conversa aberta com
o cliente do CRM. Se não corresponder, ela interrompe a importação. Mensagens de
voz são identificadas no texto como `[Áudio sem transcrição]`; elas nunca são
silenciosamente tratadas como se fossem mensagens vazias.

## Privacidade e limites

A extensão não envia mensagens e não acessa outras conversas. O texto passa do
WhatsApp Web para o CRM localmente no navegador. O WhatsApp pode alterar sua tela
e exigir uma atualização futura da extensão.
