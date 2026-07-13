# Extensão Criare CRM — Analisar WhatsApp

Extensão gratuita e de leitura para capturar a conversa escolhida no WhatsApp
Web, preservar o histórico incremental no CRM e executar a análise comercial da
Criare em um único botão.

## Instalação

1. Extraia o arquivo `criare-whatsapp-extension-2.1.2.zip`.
2. Abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta extraída.
5. Recarregue as abas do CRM e do WhatsApp Web.

## Uso

Abra um lead salvo e clique em **Capturar conversa**. O CRM abre o telefone
correto no WhatsApp Web, espera a conversa estabilizar, solicita o histórico
mais antigo disponível no celular, percorre as janelas virtualizadas, mescla as
mensagens pelo identificador do WhatsApp e só envia à análise quando consegue
confirmar a integridade mínima do histórico.

Mensagens repetidas são preservadas. Alterações de texto são atualizadas pelo
mesmo identificador. Imagem, vídeo, documento, localização, contato e figurinha
entram no histórico com marcador explícito. Para áudio, a extensão tenta obter o
arquivo/blob real e enviá-lo somente ao transcritor local em `127.0.0.1:32123`.
Se o arquivo não estiver disponível no WhatsApp Web ou o transcritor não estiver
iniciado, ele permanece como pendente/indisponível, nunca como transcrição
inventada.

## Limites e segurança

- A extensão não envia, apaga ou edita mensagens.
- Ela acessa somente o CRM da Criare e o WhatsApp Web.
- A conversa é gravada no workspace autenticado do CRM.
- O WhatsApp Web só disponibiliza o histórico sincronizado com o navegador.
- Se ainda houver mensagens antigas apenas no celular, o CRM analisa todo o
  histórico carregado e mantém essa limitação visível no lead.
- Mudanças futuras na interface do WhatsApp podem exigir atualização dos
  seletores; a versão do leitor é verificada antes de cada captura.
