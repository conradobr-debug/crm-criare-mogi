# Extensão Criare CRM — Capturar WhatsApp

Extensão gratuita e de leitura para capturar a conversa escolhida no WhatsApp
Web e salvar o histórico incremental no CRM. Ela apenas captura e salva a
conversa; a análise ocorre separadamente pela API configurada ou pelo fluxo
manual do CRM.

## Instalação

1. Extraia o arquivo `criare-whatsapp-extension-2.3.0.zip`.
2. Abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta extraída.
5. Recarregue as abas do CRM e do WhatsApp Web.

## Uso

Abra um lead salvo e clique em **Capturar conversa**. O CRM abre o telefone
canônico e único no WhatsApp Web, espera a conversa estabilizar, solicita o histórico
mais antigo disponível no celular, percorre as janelas virtualizadas, mescla as
mensagens pelo identificador do WhatsApp e informa a quantidade salva no lead.

Depois da captura, use separadamente a análise pela API ou o fluxo manual do
CRM, conforme necessário.

Se a abertura automática falhar, abra a conversa correta no WhatsApp Web e use
**Capturar conversa aberta** como fallback técnico. O uso normal continua sendo
apenas **Capturar conversa**.

Mensagens repetidas são preservadas. Alterações de texto são atualizadas pelo
mesmo identificador. Imagem, vídeo, documento, localização, contato e figurinha
entram no histórico com marcador explícito. Áudio entra somente como
`[Áudio sem transcrição]`.

Áudios são capturados sem bloquear o histórico e permanecem como
`[Áudio sem transcrição]` até o usuário iniciar o fluxo assistido no CRM.

Para transcrever áudios, baixe os arquivos manualmente no WhatsApp Web e use o
painel **Importar áudios baixados** no CRM. Os arquivos são lidos localmente,
comparados globalmente sem reutilizar mensagens, associados somente após
confirmação e enviados apenas ao Transcritor Criare
local; não permanecem armazenados pela extensão.

## Limites e segurança

- A extensão não envia, apaga ou edita mensagens.
- A conversa nunca é confirmada apenas por semelhança do nome; a identidade usada é o telefone solicitado pelo CRM.
- Ela acessa somente o CRM da Criare e o WhatsApp Web.
- A conversa é gravada no workspace autenticado do CRM.
- O WhatsApp Web só disponibiliza o histórico sincronizado com o navegador.
- Se ainda houver mensagens antigas apenas no celular, o CRM analisa todo o
  histórico carregado e mantém essa limitação visível no lead.
- Mudanças futuras na interface do WhatsApp podem exigir atualização dos
  seletores; a versão do leitor é verificada antes de cada captura.
