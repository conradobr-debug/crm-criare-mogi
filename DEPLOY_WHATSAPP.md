# WhatsApp gratuito — processo atual

O CRM oferece captura gratuita e somente leitura pelo WhatsApp Web, sem
desconectar o WhatsApp Business do celular. A versão atual da extensão está em
`whatsapp-crm-extension/` e as instruções ficam no README dessa pasta.

O botão **Analisar conversa** abre o telefone do lead, aguarda o carregamento,
solicita ao WhatsApp Web as mensagens anteriores disponíveis, percorre o
histórico virtualizado, salva a captura incremental e executa a análise. Se o
início disponibilizado pelo WhatsApp Web ou a continuidade com uma captura
completa anterior não puder ser confirmado, o CRM grava o progresso e bloqueia
a análise parcial.

Esse processo não é uma integração oficial da Meta e pode exigir manutenção
quando a interface do WhatsApp Web mudar. Ele não envia, edita nem apaga
mensagens. O histórico acessível continua limitado ao que o WhatsApp sincronizar
com o navegador.

A arquitetura oficial continua preservada como opção futura em
[DEPLOY_WHATSAPP_OFICIAL.md](./DEPLOY_WHATSAPP_OFICIAL.md), mas não é necessária
para o fluxo gratuito atual.
