(function(global){
  "use strict";

  const EMPTY_CONVERSATION_MESSAGE="Este cliente ainda não possui uma conversa do WhatsApp capturada.";
  const UNKNOWN="DESCONHECIDO";
  const clean=value=>String(value??"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,"").trim();
  const numberOrUnknown=value=>Number.isFinite(Number(value))?String(Number(value)):UNKNOWN;
  const yesNoUnknown=value=>value===true?"SIM":value===false?"NÃO":UNKNOWN;
  const valueOrUnknown=value=>clean(value)||UNKNOWN;

  const conversationStatusLabels={
    captured:"CAPTURADA",
    capture_incomplete:"INCOMPLETA",
    sync_error:"ERRO DE SINCRONIZAÇÃO",
    not_captured:"NÃO CAPTURADA",
    verification_required:"VERIFICAÇÃO NECESSÁRIA"
  };
  const completenessStatusLabels={
    complete:"COMPLETA",
    capture_may_be_incomplete:"CAPTURA POTENCIALMENTE INCOMPLETA",
    pending_audio:"ÁUDIO PENDENTE OU COM ERRO",
    unavailable_audio:"MÍDIA DE ÁUDIO INDISPONÍVEL",
    not_captured:"NÃO CAPTURADA",
    verification_required:"VERIFICAÇÃO NECESSÁRIA"
  };
  const directionLabels={incoming:"RECEBIDA",outgoing:"ENVIADA",unknown:UNKNOWN};

  function dependencies(){
    const batch=global.CriareBatchAnalysis,completeness=global.CriareConversationCompleteness;
    if(!batch?.canonicalMessages||!batch?.conversationHash||!batch?.lastMessageId||!batch?.lastMessageTimestamp)throw new Error("A lógica canônica de conversas não está disponível.");
    if(!completeness?.calculate)throw new Error("A lógica canônica de integridade não está disponível.");
    return {batch,completeness};
  }

  function clientName(record){return clean([record?.first_name,record?.last_name].filter(Boolean).join(" "))||"Sem nome";}
  function localDate(date=new Date()){
    const pad=value=>String(value).padStart(2,"0");
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  }
  function sanitizeFilenamePart(value){
    return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-")||"Cliente";
  }
  function filenameFor(record,date=new Date()){return `WhatsApp_${sanitizeFilenamePart(clientName(record))}_${localDate(date)}.md`;}
  function fenced(value){
    const text=String(value??"");
    const longest=Math.max(0,...(text.match(/`+/g)||[]).map(run=>run.length));
    const fence="`".repeat(Math.max(3,longest+1));
    return `${fence}text\n${text}\n${fence}`;
  }
  function captureConclusion(summary){
    if(summary?.conversation_status==="not_captured")return "NÃO CAPTURADA";
    if(summary?.conversation_status==="capture_incomplete")return "INCOMPLETA";
    if(summary?.conversation_status==="sync_error"||summary?.capture_may_be_incomplete===true)return "POTENCIALMENTE INCOMPLETA";
    if(summary?.conversation_status==="captured"&&summary?.capture_may_be_incomplete===false)return "COMPLETA";
    return UNKNOWN;
  }
  function reasonLines(summary){
    const reasons=Array.isArray(summary?.completeness_reasons)?summary.completeness_reasons.map(clean).filter(Boolean):[];
    return reasons.length?reasons.map(reason=>`- ${reason}`).join("\n"):`- ${UNKNOWN}`;
  }
  function messageMarkdown(message,index){
    const lines=[
      `### Mensagem ${index+1}`,
      "",
      `- message_id: ${valueOrUnknown(message?.message_id)}`,
      `- timestamp: ${valueOrUnknown(message?.timestamp)}`,
      `- remetente: ${valueOrUnknown(message?.sender)}`,
      `- direção: ${directionLabels[clean(message?.direction).toLowerCase()]||UNKNOWN}`,
      `- tipo: ${valueOrUnknown(message?.type)}`
    ];
    if(message?.reply_to_message_id)lines.push(`- resposta_a_message_id: ${clean(message.reply_to_message_id)}`);
    if(message?.reference?.message_id)lines.push(`- referência_message_id: ${clean(message.reference.message_id)}`);
    if(message?.reference?.text)lines.push("", "Referência existente:", "", fenced(message.reference.text));
    lines.push("", "Conteúdo:", "", fenced(message?.text??""));
    if(message?.audio_transcription)lines.push("", "Transcrição de áudio existente:", "", fenced(message.audio_transcription));
    return lines.join("\n");
  }

  async function createExport(record,{date=new Date()}={}){
    const {batch,completeness}=dependencies();
    const messages=batch.canonicalMessages(record);
    if(!messages.length)throw new Error(EMPTY_CONVERSATION_MESSAGE);
    const summary=completeness.calculate(record);
    const hash=await batch.conversationHash(record);
    const markdown=[
      "# Conversa de WhatsApp — Criare",
      "",
      "## Identificação do cliente",
      "",
      `- Nome: ${clientName(record)}`,
      `- ID do cadastro: ${valueOrUnknown(record?.id)}`,
      `- Telefone: ${valueOrUnknown(record?.phone)}`,
      `- whatsapp_external_chat_id: ${valueOrUnknown(record?.whatsapp_external_chat_id)}`,
      "",
      "## Integridade e completude da captura",
      "",
      `- Captura do histórico: ${captureConclusion(summary)}`,
      `- Estado canônico da captura: ${conversationStatusLabels[summary?.conversation_status]||UNKNOWN}`,
      `- Estado consolidado de integridade: ${completenessStatusLabels[summary?.conversation_completeness_status]||UNKNOWN}`,
      `- Captura potencialmente incompleta: ${yesNoUnknown(summary?.capture_may_be_incomplete)}`,
      `- Total real de mensagens exportadas: ${messages.length}`,
      `- Total de mensagens informado pela integridade canônica: ${numberOrUnknown(summary?.total_messages)}`,
      `- Total de áudios: ${numberOrUnknown(summary?.total_audio_messages)}`,
      `- Áudios com transcrição: ${numberOrUnknown(summary?.transcribed_audio_count)}`,
      `- Áudios sem transcrição: ${numberOrUnknown(summary?.pending_audio_count)}`,
      `- Áudios com erro de transcrição: ${numberOrUnknown(summary?.failed_transcription_count)}`,
      `- Mídias de áudio indisponíveis: ${numberOrUnknown(summary?.unavailable_audio_count)}`,
      `- Áudios prontos para importação: ${numberOrUnknown(summary?.ready_for_import_count)}`,
      `- Áudios com metadados pendentes: ${numberOrUnknown(summary?.metadata_pending_audio_count)}`,
      `- Primeira mensagem identificada: ${valueOrUnknown(summary?.first_message_at)}`,
      `- Última sincronização identificada: ${valueOrUnknown(summary?.last_sync_at)}`,
      `- conversation_hash: ${valueOrUnknown(hash)}`,
      `- Último message_id: ${valueOrUnknown(batch.lastMessageId(record))}`,
      `- Timestamp da última mensagem: ${valueOrUnknown(batch.lastMessageTimestamp(record))}`,
      "",
      "### Motivos factuais informados pela integridade canônica",
      "",
      reasonLines(summary),
      "",
      "## Conversa original estruturada",
      "",
      messages.map(messageMarkdown).join("\n\n")
    ].join("\n");
    return {filename:filenameFor(record,date),markdown,messages,completeness:summary};
  }

  async function download(record,{date=new Date(),environment=global}={}){
    const exported=await createExport(record,{date});
    const blob=new environment.Blob([exported.markdown],{type:"text/markdown;charset=utf-8"});
    const url=environment.URL.createObjectURL(blob),link=environment.document.createElement("a");
    link.href=url;link.download=exported.filename;link.style.display="none";
    environment.document.body?.appendChild(link);link.click();link.remove?.();
    environment.setTimeout(()=>environment.URL.revokeObjectURL(url),1000);
    return exported;
  }

  global.CriareWhatsAppChatGptExport={EMPTY_CONVERSATION_MESSAGE,createExport,download,filenameFor,sanitizeFilenamePart};
  if(typeof module!=="undefined"&&module.exports)module.exports=global.CriareWhatsAppChatGptExport;
})(typeof window!=="undefined"?window:globalThis);
