(function(global){
  "use strict";

  const VERSION="2.5.1";
  const clean=value=>String(value??"").replace(/\s+/g," ").trim();
  const normalizeId=value=>clean(value).replace(/^wa:/i,"").toUpperCase();
  const AUDIO_MARKER=/\[(?:Áudio sem transcrição|Transcrição de áudio)\]/i;
  const UNAVAILABLE=/m[ií]dia indispon[ií]vel|media_unavailable|legacy_unavailable|arquivo_inexistente|indispon[ií]vel/i;
  const FAILED=/transcription_error|transcription_failed|whisper_error|erro_transcri|failed/i;

  function isAudio(entry){return entry?.type==="Áudio"||entry?.type==="audio"||entry?.hasVoiceMessage===true||Boolean(entry?.audioMeta)||AUDIO_MARKER.test(clean(entry?.text));}
  function transcript(entry){
    const direct=clean(entry?.transcript||entry?.audio_transcription||entry?.audioMeta?.transcription);
    if(direct)return direct;
    const match=clean(entry?.text).match(/\[Transcrição de áudio\]\s*(.+)$/i);
    return clean(match?.[1]);
  }
  function timestamp(entry){
    for(const value of [entry?.timestamp,entry?.message_timestamp,entry?.occurred_at]){const date=new Date(value||"");if(!Number.isNaN(date.getTime()))return date.toISOString();}
    const raw=clean(entry?.text);const prefix=raw.match(/^\[([^,\]]+),\s*([^\]]+)\]/);const date=clean(entry?.date||prefix?.[2]).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);const time=clean(entry?.message_time||entry?.time||prefix?.[1]).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if(!date||!time)return null;
    return `${date[3]}-${date[2].padStart(2,"0")}-${date[1].padStart(2,"0")}T${time[1].padStart(2,"0")}:${time[2]}:${time[3]||"00"}-03:00`;
  }
  function audioStatus(entry){
    if(!normalizeId(entry?.message_id||entry?.id))return "verification_required";
    if(transcript(entry))return "transcribed";
    const state=clean(entry?.transcription_status||entry?.audioMeta?.transcriptionStatus||entry?.audioMeta?.status||entry?.media_status||entry?.status).toLowerCase();
    if(FAILED.test(state))return "transcription_error";
    if(UNAVAILABLE.test(`${state} ${clean(entry?.text)} ${clean(entry?.audioMeta?.reason)}`))return "media_unavailable";
    if(entry?.file_obtained===true||entry?.audioMeta?.fileObtained===true||/ready|pronto|import/i.test(state))return "pending_import";
    return "pending_download";
  }
  function canonicalEntries(record){
    const structured=Array.isArray(record?.whatsapp_message_entries)?record.whatsapp_message_entries:[];const source=structured.length?structured:clean(record?.whatsapp_transcript).split(/\n+/).map(text=>({text})).filter(entry=>entry.text);
    const byId=new Map(),anonymous=[];
    source.forEach((entry,index)=>{
      const id=normalizeId(entry?.message_id||entry?.id);const candidate={...entry,message_id:id||null,position:Number.isFinite(Number(entry?.chronological_position))?Number(entry.chronological_position):index,timestamp:timestamp(entry)};
      if(!id){anonymous.push(candidate);return;}
      const prior=byId.get(id);if(!prior){byId.set(id,candidate);return;}
      const priorTranscript=transcript(prior),nextTranscript=transcript(candidate);
      byId.set(id,{...prior,...candidate,audioMeta:{...(prior.audioMeta||{}),...(candidate.audioMeta||{})},transcript:nextTranscript||priorTranscript||candidate.transcript});
    });
    return [...byId.values(),...anonymous].sort((a,b)=>{const at=Date.parse(a.timestamp||""),bt=Date.parse(b.timestamp||"");if(Number.isFinite(at)&&Number.isFinite(bt)&&at!==bt)return at-bt;return a.position-b.position;});
  }
  function analysisStatus(record,lastSync){
    const raw=clean(record?.whatsapp_analysis_status).toLowerCase();
    if(raw==="stale")return "stale";
    const updated=Date.parse(record?.whatsapp_analysis_updated_at||"");
    if(!Number.isFinite(updated))return "never";
    if(lastSync&&updated<Date.parse(lastSync))return "stale";
    return raw==="error"?"error":"current";
  }
  function calculate(record,options={}){
    const entries=canonicalEntries(record),audios=entries.filter(isAudio).map(entry=>({...entry,audio_status:audioStatus(entry)}));
    const dated=entries.map(entry=>entry.timestamp).filter(Boolean).sort();
    const lastSync=record?.whatsapp_transcript_updated_at||record?.whatsapp_last_sync_at||record?.whatsapp_synced_at||null;
    const identity=clean(options.identity_status||record?.whatsapp_identity_status).toLowerCase();
    let conversation_status;
    if(identity&&!new Set(["ready","valid","conversation_linked","whatsapp_ready"]).has(identity))conversation_status="verification_required";
    else if(record?.whatsapp_sync_error)conversation_status="sync_error";
    else if(!entries.length&&!clean(record?.whatsapp_transcript))conversation_status="not_captured";
    else if(record?.whatsapp_capture_complete===false)conversation_status="capture_incomplete";
    else conversation_status="captured";
    const counts={transcribed:0,pending_download:0,pending_import:0,transcription_error:0,media_unavailable:0,verification_required:0};audios.forEach(item=>counts[item.audio_status]++);
    const analysis_status=analysisStatus(record,lastSync),pending=counts.pending_download+counts.pending_import+counts.verification_required;
    const pendingAudios=audios.filter(item=>["pending_download","pending_import","verification_required"].includes(item.audio_status));
    const readyForImport=pendingAudios.filter(item=>normalizeId(item.message_id||item.id)&&item.duration_valid===true&&Number(item.duration_seconds||item.duration)>0&&clean(item.sender)&&["incoming","outgoing"].includes(clean(item.direction).toLowerCase())&&clean(item.date)&&clean(item.message_time||item.time));
    const metadataPending=Math.max(0,pendingAudios.length-readyForImport.length);
    let conversation_completeness_status="complete";
    if(conversation_status==="verification_required")conversation_completeness_status="verification_required";
    else if(conversation_status==="not_captured")conversation_completeness_status="not_captured";
    else if(conversation_status==="capture_incomplete"||conversation_status==="sync_error")conversation_completeness_status="capture_may_be_incomplete";
    else if(pending||counts.transcription_error)conversation_completeness_status="pending_audio";
    else if(counts.media_unavailable)conversation_completeness_status="unavailable_audio";
    const reasons=[];
    if(conversation_status==="not_captured")reasons.push("Conversa ainda não capturada.");
    if(conversation_status==="capture_incomplete")reasons.push("O WhatsApp Web não confirmou a captura integral do histórico disponível.");
    if(conversation_status==="sync_error")reasons.push(`Falha na última sincronização: ${clean(record.whatsapp_sync_error)}.`);
    if(conversation_status==="verification_required")reasons.push("A identidade do telefone precisa ser confirmada antes de usar o WhatsApp.");
    if(pending)reasons.push(`${pending} áudio(s) ainda sem transcrição.`);
    if(metadataPending)reasons.push(`${metadataPending} áudio(s) aguardando atualização de metadados, como duração, horário ou remetente.`);
    if(counts.transcription_error)reasons.push(`${counts.transcription_error} áudio(s) com falha de transcrição.`);
    if(counts.media_unavailable)reasons.push(`${counts.media_unavailable} áudio(s) indisponível(is) no WhatsApp.`);
    if(!reasons.length)reasons.push(audios.length?`Conversa completa: ${audios.length} áudio(s) encontrado(s) e ${counts.transcribed} transcrito(s).`:"Conversa completa sem áudios pendentes.");
    return {conversation_status,total_messages:entries.length||Number(record?.whatsapp_sync_message_count||0),first_message_at:dated[0]||null,last_message_at:dated.at(-1)||null,last_sync_at:lastSync,total_audio_messages:audios.length,transcribed_audio_count:counts.transcribed,pending_audio_count:pending,ready_for_import_count:readyForImport.length,metadata_pending_audio_count:metadataPending,unavailable_audio_count:counts.media_unavailable,failed_transcription_count:counts.transcription_error,analysis_status,conversation_completeness_status,completeness_reasons:reasons,capture_may_be_incomplete:conversation_status==="capture_incomplete"||conversation_status==="sync_error",audio_messages:audios.map(item=>({...item,import_readiness:item.audio_status==="transcribed"?"already_transcribed":item.audio_status==="media_unavailable"?"media_unavailable":item.audio_status==="transcription_error"?"transcription_error":readyForImport.some(ready=>ready.message_id===item.message_id)?"ready_for_import":"metadata_update_required"}))};
  }
  function priority(summary){
    if(summary.pending_audio_count&&summary.analysis_status!=="current")return 0;
    if(summary.failed_transcription_count)return 1;
    if(summary.conversation_completeness_status==="capture_may_be_incomplete"||summary.conversation_completeness_status==="not_captured"||summary.conversation_completeness_status==="verification_required")return 2;
    if(summary.unavailable_audio_count)return 3;
    if(summary.pending_audio_count)return 4;
    return 5;
  }
  function sortRows(rows){return [...rows].sort((a,b)=>priority(a.summary)-priority(b.summary)||(Date.parse(b.summary.last_message_at||b.summary.last_sync_at||0)-Date.parse(a.summary.last_message_at||a.summary.last_sync_at||0)));}
  function matchesFilter(summary,scope){if(scope==="pending")return summary.pending_audio_count>0||summary.failed_transcription_count>0;if(scope==="not_captured")return summary.conversation_status==="not_captured";if(scope==="incomplete")return summary.conversation_completeness_status!=="complete";if(scope==="outdated")return summary.analysis_status!=="current";if(scope==="issues")return summary.pending_audio_count>0||summary.failed_transcription_count>0||summary.conversation_completeness_status!=="complete";return true;}
  function matchesSearch(record,phoneValues,query){const needle=clean(query).toLocaleLowerCase("pt-BR");if(!needle)return true;const name=clean([record?.first_name,record?.last_name].filter(Boolean).join(" "));return [name,...(Array.isArray(phoneValues)?phoneValues:[phoneValues])].map(value=>clean(value).toLocaleLowerCase("pt-BR")).some(value=>value.includes(needle));}
  function buildSyncQueue(records,identityFor=()=>({ready:true,code:"ready"})){return records.map(record=>{const identity=identityFor(record)||{};let status="waiting";if(identity.code==="phone_duplicate")status="phone_duplicate";else if(!identity.ready)status=identity.code==="phone_invalid"||identity.code==="phone_missing"?"phone_invalid":"verification_required";return {record,status,normalized_phone:identity.normalized||null};});}

  global.CriareConversationCompleteness={version:VERSION,normalizeId,isAudio,audioStatus,canonicalEntries,calculate,priority,sortRows,matchesFilter,matchesSearch,buildSyncQueue};
})(typeof window!=="undefined"?window:globalThis);
