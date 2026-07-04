# Extensão Criare CRM — Capturar WhatsApp

Esta extensão gratuita abre cada cliente no WhatsApp Web, carrega o histórico
antigo disponível no celular, captura as mensagens e a foto de perfil e grava
o conteúdo no CRM Criare. A atualização pode ser individual ou em lote, sempre
processando uma conversa por vez.

## Instalação em cada computador

1. Abra `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Escolha esta pasta `whatsapp-crm-extension`.
5. Atualize as abas do CRM e do WhatsApp Web.

A extensão fica instalada localmente no Chrome. Portanto, repita a instalação
em cada computador usado para atualizar conversas. Em cada máquina, o WhatsApp
Web também precisa estar conectado à conta da Criare. Os históricos salvos no
CRM, por outro lado, ficam disponíveis para todos os usuários autorizados.

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

Quando o WhatsApp mostra o aviso **Clique neste aviso para carregar mensagens
mais antigas do seu celular**, a extensão aciona o carregamento automaticamente
e aguarda até 20 segundos antes de continuar. Contatos sem conversa são
classificados como **sem conversa**, sem interromper a atualização em lote.

Na atualização automática, a extensão reutiliza uma única aba do WhatsApp Web,
navega pelo telefone cadastrado, aguarda o histórico correto e devolve o
resultado ao registro correspondente. O modo em lote só avança depois que o
cliente atual terminou, evitando a mistura de conversas.

Cada mensagem capturada é comparada com o histórico já salvo. A atualização
acrescenta somente mensagens novas, preserva as anteriores e pode ser repetida
sem duplicar o conteúdo. Se um telefone inválido abrir um aviso no WhatsApp, a
extensão fecha esse aviso antes de avançar para o próximo cliente.

Antes de extrair, a extensão aguarda a quantidade de mensagens carregadas ficar
estável. Isso evita salvar apenas o último áudio ou a última mensagem enquanto
os demais balões ainda estão aparecendo na tela.

A extensão também verifica a versão do leitor que está rodando dentro da aba do
WhatsApp Web. Se o Chrome manteve um leitor antigo depois de uma atualização, a
aba é recarregada automaticamente. A captura é recusada quando a quantidade
lida for menor que a quantidade de mensagens visíveis, protegendo o histórico.

Quando o cadastro possui nome e sobrenome, mas o WhatsApp mostra apenas o
primeiro nome no cabeçalho, a conversa ainda é reconhecida como correta. Números
exibidos no cabeçalho continuam sendo validados pelo telefone completo.

A foto exibida no cabeçalho da conversa é copiada para uma área privada do CRM;
o endereço temporário do WhatsApp não é gravado no cadastro.
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
