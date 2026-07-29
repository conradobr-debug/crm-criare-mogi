(function(global){
  "use strict";

  function cleanText(value){
    return String(value || "")
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizedUiText(value){
    return cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }


  const WHATSAPP_SYSTEM_MESSAGE_PATTERNS=[
    /\b(?:as )?mensagens e ligacoes sao protegidas com (?:a )?criptografia de ponta a ponta\b/,
    /\b(?:messages and calls (?:are )?(?:end to end encrypted|protected with end to end encryption)|messages and calls are protected by end to end encryption)\b/,
    /\b(?:los )?mensajes y (?:las )?llamadas estan protegidos con (?:el )?cifrado de extremo a extremo\b/,
    /\b(?:somente|apenas) as pessoas que fazem parte (?:da|desta) conversa podem (?:ler|ouvir|compartilhar)\b/,
    /\bonly (?:the )?people (?:who are )?(?:in|part of) (?:this |the )?(?:chat|conversation) can (?:read|listen|share)\b/,
    /\bsolo las personas que forman parte de (?:esta |la )?conversacion pueden (?:leer|escuchar|compartir)\b/,
    /\b(?:clique|toque) para (?:saber|saiba) mais\b/,
    /\bclick (?:to )?(?:learn|know) more\b/,
    /\b(?:haz clic|toque) para (?:obtener|saber) mas(?: informacion)?\b/,
    /\b(?:codigo de seguranca|security code|codigo de seguridad).*(?:mudou|changed|cambio)\b/
  ];

  function normalizedWhatsAppSystemText(value){
    return normalizedUiText(value)
      .replace(/(?:ic[-_ ]*)?lock[-_ ]*filled/g," ")
      .replace(/^(?:autor nao identificado\s*)+/,"")
      .replace(/^(?:data nao identificada\s*horario nao identificado\s*)+/,"")
      .trim();
  }

  function isKnownWhatsAppSystemText(value){
    const text=normalizedWhatsAppSystemText(value);
    return Boolean(text)&&WHATSAPP_SYSTEM_MESSAGE_PATTERNS.some(pattern=>pattern.test(text));
  }

  function hasStrongCanonicalMessageId(entry){
    const raw=cleanText(entry?.message_id||entry?.id);
    const normalized=normalizeWhatsAppMessageId(raw);
    return /^(?:true|false)_[^_]+(?:@(?:c\.us|g\.us))?_[A-Z0-9_-]{6,}$/i.test(raw)
      ||/^[A-F0-9]{16,}$/i.test(normalized);
  }

  function isKnownWhatsAppSystemEntry(entry){
    if(!isKnownWhatsAppSystemText(entry?.text))return false;
    const parsed=parsePrefix(String(entry?.text||"").match(/^\[[^\]]+\]\s*[^:]+:\s*/)?.[0]||"");
    const author=normalizedUiText(entry?.sender||parsed.author);
    const date=normalizedUiText(entry?.date||parsed.date);
    const time=cleanText(entry?.message_time||entry?.time||parsed.time);
    const placeholderAuthor=!author||/^(?:autor|remetente|contato) nao identificado$|^mensagem$/.test(author);
    const placeholderDate=!date||/nao identificada|sem data|desconhecida/.test(date);
    const placeholderTime=!time||/nao identificado|sem horario|desconhecido/.test(normalizedUiText(time));
    if(placeholderAuthor||placeholderDate||placeholderTime)return true;
    if(hasStrongCanonicalMessageId(entry))return false;
    const rawId=cleanText(entry?.message_id||entry?.id);
    return !rawId||/^(?:fp:|node:|system:|legacy:)/i.test(rawId);
  }

  function removeKnownWhatsAppSystemMessages(entries,{completeHistory=false}={}){
    const normalized=(Array.isArray(entries)?entries:[]).map(normalizeEntry).filter(Boolean);
    return completeHistory?normalized.filter(entry=>!isKnownWhatsAppSystemEntry(entry)):normalized;
  }

  function normalizeWhatsAppMessageId(value){
    return cleanText(value).replace(/^(?:wa:)+/i,"").toUpperCase();
  }

  function audioDurationSource(entry){
    return cleanText(entry?.duration_source||entry?.audioMeta?.durationSource||"").toLowerCase();
  }

  function audioDurationPriority(entry){
    const source=audioDurationSource(entry);
    if(source==="whatsapp_player")return 5;
    if(["manual_confirmed","imported_confirmed","imported_file","confirmed"].includes(source))return 4;
    if(source==="audio_meta"||source==="message_duration")return 3;
    if(source==="unconfirmed")return 2;
    if(source==="legacy_invalid")return 1;
    const audioMetaDuration=Number(entry?.audioMeta?.durationSeconds||0);
    if(Number.isFinite(audioMetaDuration)&&audioMetaDuration>0&&audioMetaDuration<600)return 3;
    return 0;
  }

  function isAudioEntry(entry){
    return entry?.type==="Áudio"||entry?.hasVoiceMessage||Boolean(entry?.audioMeta)||/\[(?:Áudio sem transcrição|Transcrição de áudio)\]/i.test(String(entry?.text||""));
  }

  function entryEnvelope(entry){
    const parsed=parsePrefix(String(entry?.text||"").match(/^\[[^\]]+\]\s*[^:]+:\s*/)?.[0]||"");
    return {
      sender:normalizedUiText(entry?.sender||parsed.author),
      date:normalizedUiText(entry?.date||parsed.date),
      time:audioTimeKey(entry)||cleanText(parsed.time),
      direction:normalizedUiText(entry?.direction)
    };
  }

  function hasConfirmedAudioEvidence(entry){
    const transcript=cleanText(entry?.transcript||entry?.audioMeta?.transcription||entry?.audioMeta?.transcriptionText);
    const duration=Number(entry?.duration_seconds||entry?.duration||entry?.audioMeta?.durationSeconds||0);
    const durationSource=audioDurationSource(entry);
    const validDuration=Number.isFinite(duration)&&duration>0&&duration<600&&durationSource!=="legacy_invalid";
    const sourceAvailable=Boolean(entry?.audioMeta?.sourceAvailable
      ||/[a-z]/i.test(cleanText(entry?.audioMeta?.source))&&cleanText(entry?.audioMeta?.source)!=="none"
      ||["whatsapp_player","manual_confirmed","imported_confirmed","imported_file","confirmed"].includes(durationSource));
    const fileAvailable=Boolean(Number(entry?.audioMeta?.sizeBytes||0)>0||cleanText(entry?.audioMeta?.sha256));
    return Boolean(transcript||validDuration||sourceAvailable||fileAvailable);
  }

  // Um marcador técnico só pode ser retirado por uma captura manual que tenha
  // efetivamente alcançado o início do histórico. Em qualquer outra leitura,
  // inclusive incremental/parcial, o histórico existente é intocável.
  function removeStaleAudioMarkers(storedEntries,incomingEntries,{completeHistory=false,currentCanonicalIds=[]}={}){
    const stored=(Array.isArray(storedEntries)?storedEntries:[]).map(normalizeEntry).filter(Boolean);
    const incoming=(Array.isArray(incomingEntries)?incomingEntries:[]).map(normalizeEntry).filter(Boolean);
    if(!completeHistory)return stored;
    const incomingById=new Map(incoming.map(entry=>[normalizeWhatsAppMessageId(entry.message_id||entry.id),entry]).filter(([id])=>id));
    const currentIds=new Set([
      ...currentCanonicalIds,
      ...incoming.map(entry=>entry.message_id||entry.id)
    ].map(normalizeWhatsAppMessageId).filter(Boolean));
    return stored.filter(entry=>{
      if(!isAudioEntry(entry))return true;
      const isPlaceholder=/^\[[^\]]+\]\s*[^:]+:\s*\[Áudio sem transcrição\]\s*$/i.test(cleanText(entry?.text));
      if(hasConfirmedAudioEvidence(entry)||!isPlaceholder)return true;
      const id=normalizeWhatsAppMessageId(entry.message_id||entry.id);
      const current=incomingById.get(id);
      if(current)return !(!isAudioEntry(current)&&cleanText(current.text));
      if(id&&currentIds.has(id))return true;
      const envelope=entryEnvelope(entry);
      // IDs auxiliares sem mensagem canônica correspondente são justamente os
      // órfãos que esta limpeza defensiva corrige.
      if(!id||/^AUDIO:/i.test(id))return false;
      if(!envelope.sender||!envelope.date||!envelope.time)return false;
      const textMatch=incoming.some(candidate=>{
        if(isAudioEntry(candidate))return false;
        const other=entryEnvelope(candidate);
        return other.sender===envelope.sender&&other.date===envelope.date&&other.time===envelope.time
          &&(!envelope.direction||!other.direction||other.direction===envelope.direction);
      });
      return !textMatch;
    });
  }

  // O leitor pode usar literalmente "data não identificada" enquanto a bolha
  // canônica ainda carrega a data real. Esse texto é um placeholder, não uma
  // identidade suficiente para manter um segundo áudio técnico no inventário.
  function hasCanonicalAudioIdentity(entry){
    const sender=normalizedUiText(entry?.sender);
    const date=normalizedUiText(entry?.date);
    const missingDate=!date||/^(?:data )?nao identificada$|^sem data$|^data desconhecida$/.test(date);
    return Boolean(sender)&&!missingDate;
  }

  // IDs que começam com AUDIO: são chaves auxiliares criadas pelo CRM quando
  // o WhatsApp ainda não expôs o data-id canônico da bolha. Eles nunca devem
  // vencer um ID real do WhatsApp para a mesma mensagem.
  function isSyntheticAudioMessageId(entry){
    return /^AUDIO:/i.test(normalizeWhatsAppMessageId(entry?.message_id||entry?.id));
  }

  function audioTimeKey(entry){
    return (cleanText(entry?.message_time||entry?.time).match(/\d{1,2}:\d{2}/)||[])[0]||"";
  }

  function sameAudioEnvelope(candidate,canonical){
    if(!isAudioEntry(candidate)||!isAudioEntry(canonical))return false;
    const candidateTime=audioTimeKey(candidate),canonicalTime=audioTimeKey(canonical);
    if(!candidateTime||candidateTime!==canonicalTime)return false;
    const candidateSender=normalizedUiText(candidate?.sender),canonicalSender=normalizedUiText(canonical?.sender);
    if(candidateSender&&canonicalSender&&candidateSender!==canonicalSender)return false;
    const candidateDirection=normalizedUiText(candidate?.direction),canonicalDirection=normalizedUiText(canonical?.direction);
    if(candidateDirection&&canonicalDirection&&candidateDirection!==canonicalDirection)return false;
    const candidateDate=normalizedUiText(candidate?.date),canonicalDate=normalizedUiText(canonical?.date);
    const candidateDateKnown=hasCanonicalAudioIdentity(candidate),canonicalDateKnown=hasCanonicalAudioIdentity(canonical);
    return !(candidateDateKnown&&canonicalDateKnown&&candidateDate!==canonicalDate);
  }

  function mergeEntryMetadata(stored,incoming){
    const canonical=normalizeWhatsAppMessageId(incoming?.message_id||incoming?.id||stored?.message_id||stored?.id);
    if(!isAudioEntry(stored)&&!isAudioEntry(incoming))return {...stored,...incoming,...(canonical?{message_id:canonical}:{})};
    // Uma leitura completa posterior pode revelar que o mesmo data-id é texto,
    // não áudio. Não mantenha audioMeta/hasVoiceMessage antigos nesse caso:
    // isso transformava texto real em "[Áudio sem transcrição]" no CRM.
    const incomingIsExplicitText=!isAudioEntry(incoming)&&cleanText(incoming?.text);
    if(incomingIsExplicitText){
      const cleaned={...stored,...incoming};
      delete cleaned.audioMeta;
      delete cleaned.audioTranscribed;
      delete cleaned.hasVoiceMessage;
      delete cleaned.duration;
      delete cleaned.duration_text;
      delete cleaned.duration_seconds;
      delete cleaned.duration_source;
      delete cleaned.duration_valid;
      if(canonical)cleaned.message_id=canonical;
      return cleaned;
    }
    const merged={...stored,...incoming,audioMeta:{...(stored?.audioMeta||{}),...(incoming?.audioMeta||{})}};
    const storedPriority=audioDurationPriority(stored),incomingPriority=audioDurationPriority(incoming);const durationWinner=incomingPriority>storedPriority?incoming:stored;
    for(const key of ["duration","duration_text","duration_seconds","duration_source","duration_valid"]){if(durationWinner?.[key]!==undefined)merged[key]=durationWinner[key];else delete merged[key];}
    merged.audioMeta.durationSeconds=durationWinner?.audioMeta?.durationSeconds??durationWinner?.duration_seconds??durationWinner?.duration??null;merged.audioMeta.durationSource=audioDurationSource(durationWinner)||"missing";
    if(stored?.audioTranscribed||stored?.audioMeta?.transcription){merged.text=stored.text;merged.audioTranscribed=true;merged.audioMeta.transcription=stored.audioMeta?.transcription||"";merged.audioMeta.transcriptionStatus=stored.audioMeta?.transcriptionStatus||"completed";}
    if(canonical)merged.message_id=canonical;
    return merged;
  }

  function messageHash(value){
    let hash = 2166136261;
    const text = String(value || "");
    for(let index=0; index<text.length; index+=1){
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function parsePrefix(value){
    const raw = cleanText(value);
    const match = raw.match(/^\[([^,\]]+),\s*([^\]]+)\]\s*([^:]+):\s*$/);
    if(!match) return {raw, time:"", date:"", author:""};
    return {
      raw,
      time:cleanText(match[1]),
      date:cleanText(match[2]),
      author:cleanText(match[3])
    };
  }

  function continuationPrefix(previousPrefix, visibleTime, explicitAuthor){
    const previous = parsePrefix(previousPrefix);
    const author = cleanText(explicitAuthor).replace(/:\s*$/, "") || previous.author || "Autor não identificado";
    const date = previous.date || "data não identificada";
    const time = cleanText(visibleTime) || previous.time || "horário não identificado";
    return `[${time}, ${date}] ${author}: `;
  }

  function playerDurationSeconds(value){
    const match=String(value||"").match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    return match ? (match[3] ? Number(match[1])*3600+Number(match[2])*60+Number(match[3]) : Number(match[1])*60+Number(match[2])) : null;
  }

  function normalizeEntry(entry){
    if(!entry) return null;
    if(typeof entry === "string"){
      const text = cleanText(entry);
      return text ? {id:null, text} : null;
    }
    const text = cleanText(entry.text);
    if(!text) return null;
    return {
      ...entry,
      id:cleanText(entry.id) || null,
      message_id:normalizeWhatsAppMessageId(entry.message_id||entry.id)||null,
      text,
      capturedAt:cleanText(entry.capturedAt) || null
    };
  }

  function mergeEntries(storedEntries, incomingEntries, maximum=10000){
    const stored = (Array.isArray(storedEntries) ? storedEntries : []).map(normalizeEntry).filter(Boolean);
    const incoming = (Array.isArray(incomingEntries) ? incomingEntries : []).map(normalizeEntry).filter(Boolean);
    const merged = stored.map(entry=>({...entry}));
    const indexById = new Map();
    merged.forEach((entry,index)=>{const key=normalizeWhatsAppMessageId(entry.message_id||entry.id);if(key)indexById.set(key,index);});
    let addedCount = 0;
    let updatedCount = 0;

    for(const entry of incoming){
      const entryKey=normalizeWhatsAppMessageId(entry.message_id||entry.id);
      if(entryKey && indexById.has(entryKey)){
        const index = indexById.get(entryKey);const next=mergeEntryMetadata(merged[index],entry);
        if(JSON.stringify(merged[index])!==JSON.stringify(next)){
          merged[index] = next;
          updatedCount += 1;
        }
        continue;
      }
      if(!entry.id && merged.some(saved=>saved.text === entry.text)) continue;
      merged.push({...entry});
      if(entryKey) indexById.set(entryKey, merged.length - 1);
      addedCount += 1;
    }

    const limited = merged.length > maximum;
    const entries = limited ? merged.slice(-maximum) : merged;
    return {entries, addedCount, updatedCount, limited};
  }

  function mergeMessageWindow(currentEntries, visibleEntries,{prepend=true}={}){
    const current=(Array.isArray(currentEntries)?currentEntries:[]).map(normalizeEntry).filter(Boolean);
    const visible=(Array.isArray(visibleEntries)?visibleEntries:[]).map(normalizeEntry).filter(Boolean);
    const currentByKey=new Map();
    current.forEach((entry,index)=>{
      const canonical=normalizeWhatsAppMessageId(entry.message_id||entry.id);
      const key=canonical?`id:${canonical}`:`fallback:${entry.id||messageHash(entry.text)}`;
      currentByKey.set(key,{list:"current",index});
    });
    const additions=[];let updatedCount=0;
    for(const entry of visible){
      const canonical=normalizeWhatsAppMessageId(entry.message_id||entry.id);
      const key=canonical?`id:${canonical}`:`fallback:${entry.id||messageHash(entry.text)}`;
      if(currentByKey.has(key)){
        const found=currentByKey.get(key);const target=found.list==="current"?current:additions;const merged=mergeEntryMetadata(target[found.index],entry);
        if(JSON.stringify(target[found.index])!==JSON.stringify(merged)){target[found.index]=merged;updatedCount+=1;}
        continue;
      }
      currentByKey.set(key,{list:"additions",index:additions.length});
      additions.push(entry);
    }
    return {entries:prepend?[...additions,...current]:[...current,...additions],addedCount:additions.length,updatedCount};
  }

  // O WhatsApp pode expor um data-id interno do player além do data-id da
  // mensagem. Nunca mantemos esse registro incompleto quando a mesma bolha
  // já foi lida com remetente, data e horário canônicos.
  function pruneOrphanAudioEntries(entries){
    const normalized=(Array.isArray(entries)?entries:[]).map(normalizeEntry).filter(Boolean);
    return normalized.filter(entry=>{
      if(!isAudioEntry(entry))return true;
      const missingIdentity=!hasCanonicalAudioIdentity(entry);
      const time=(cleanText(entry.message_time||entry.time).match(/\d{1,2}:\d{2}/)||[])[0]||"";
      if(!missingIdentity||!time)return true;
      const completeAtSameTime=normalized.filter(other=>other!==entry&&isAudioEntry(other)
        &&hasCanonicalAudioIdentity(other)
        &&((cleanText(other.message_time||other.time).match(/\d{1,2}:\d{2}/)||[])[0]||"")===time
        &&normalizeWhatsAppMessageId(other.message_id||other.id)!==normalizeWhatsAppMessageId(entry.message_id||entry.id));
      return completeAtSameTime.length!==1;
    });
  }

  // Alguns layouts do WhatsApp expõem um ID da bolha e outro ID do player.
  // Quando só existe uma bolha com remetente/data naquele minuto, ela é a
  // identidade canônica: incorporamos nela a duração obtida pelo player e
  // descartamos os IDs técnicos incompletos.
  function consolidateAudioEntries(entries){
    const normalized=(Array.isArray(entries)?entries:[]).map(normalizeEntry).filter(Boolean);
    const result=[...normalized];
    // Primeiro, elimina chaves sintéticas AUDIO: quando existe exatamente uma
    // mensagem real com o mesmo remetente/direção/data-hora. Isso cobre o
    // caso em que a chave auxiliar também recebeu uma data posteriormente.
    for(const entry of normalized){
      if(!isSyntheticAudioMessageId(entry))continue;
      const realMatches=result.filter(item=>!isSyntheticAudioMessageId(item)&&sameAudioEnvelope(entry,item));
      if(realMatches.length!==1)continue;
      const canonical=realMatches[0];
      const merged=mergeEntryMetadata(entry,canonical);
      const at=result.indexOf(canonical);if(at>=0)result[at]=merged;
      const syntheticAt=result.indexOf(entry);if(syntheticAt>=0)result.splice(syntheticAt,1);
    }
    for(const entry of normalized){
      if(!result.includes(entry)||!isAudioEntry(entry)||hasCanonicalAudioIdentity(entry))continue;
      const time=audioTimeKey(entry);if(!time)continue;
      const complete=result.filter(item=>isAudioEntry(item)&&hasCanonicalAudioIdentity(item)&&audioTimeKey(item)===time);
      if(complete.length!==1)continue;
      const canonical=complete[0];
      const merged=mergeEntryMetadata(entry,canonical);
      const at=result.indexOf(canonical);if(at>=0)result[at]=merged;
      const orphanAt=result.indexOf(entry);if(orphanAt>=0)result.splice(orphanAt,1);
    }
    return pruneOrphanAudioEntries(result);
  }

  function audioUnavailable(entry){
    const state=[entry?.media_status,entry?.audioMeta?.extractionStatus,entry?.audioMeta?.transcriptionStatus,entry?.audioMeta?.error,entry?.text].map(normalizedUiText).join(" ");
    return /media_unavailable|legacy_unavailable|nao_localizado_no_dom|arquivo_inexistente|mensagem de midia indisponivel/.test(state);
  }

  function audioFileTimestamp(name){
    const match=String(name||"").match(/(\d{4})[-_.](\d{2})[-_.](\d{2}).*?(\d{1,2})[.:_-](\d{2})(?:[.:_-](\d{2}))?/i);
    if(!match)return null;
    return Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]),Number(match[5]),Number(match[6]||0));
  }

  function audioMessageTimestamp(entry){
    const date=String(entry?.date||"").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);const time=String(entry?.time||"").match(/(\d{1,2}):(\d{2})/);
    if(!date||!time)return null;
    return Date.UTC(Number(date[3]),Number(date[2])-1,Number(date[1]),Number(time[1]),Number(time[2]),0);
  }

  function audioMatchCandidates(file,candidates,{fileIndex=0,fileCount=1}={}){
    const eligible=(Array.isArray(candidates)?candidates:[]).filter(entry=>!audioUnavailable(entry)).sort((a,b)=>Number(a.chronological_position||0)-Number(b.chronological_position||0));
    const fileTime=Number(file?.timestamp||audioFileTimestamp(file?.name));const fileDuration=Number(file?.duration||0);const fileName=normalizedUiText(file?.name||"");const fileSender=normalizedUiText(file?.sender||"");
    return eligible.map((entry,index)=>{
      const signals=[];let weighted=0,totalWeight=0;const messageTime=audioMessageTimestamp(entry);
      if(Number.isFinite(fileTime)&&Number.isFinite(messageTime)){const diff=Math.abs(fileTime-messageTime)/1000;const quality=Math.max(0,1-diff/(12*60*60));weighted+=40*quality;totalWeight+=40;if(quality>=.8)signals.push("horário compatível");}
      const expected=Number(entry?.duration||entry?.audioMeta?.durationSeconds||0);if(fileDuration>0&&expected>0){const diff=Math.abs(fileDuration-expected);const quality=Math.max(0,1-diff/20);weighted+=35*quality;totalWeight+=35;if(quality>=.8)signals.push("duração compatível");}
      const sender=normalizedUiText(entry?.sender||"");const senderKnown=Boolean(fileSender||sender&&fileName.includes(sender));if(senderKnown&&sender){const quality=(fileSender===sender||fileName.includes(sender))?1:0;weighted+=15*quality;totalWeight+=15;if(quality)signals.push("remetente compatível");}
      if(fileCount>1&&eligible.length>1){const expectedRank=Math.round((fileIndex/(fileCount-1))*(eligible.length-1));const quality=Math.max(0,1-Math.abs(index-expectedRank)/Math.max(1,eligible.length-1));weighted+=10*quality;totalWeight+=10;if(quality>=.8)signals.push("sequência cronológica compatível");}
      const score=totalWeight?Math.round((weighted/totalWeight)*100):0;
      return {id:entry.id,message_id:entry.message_id||entry.id,score,signals,entry};
    }).sort((a,b)=>b.score-a.score||Number(a.entry.chronological_position||0)-Number(b.entry.chronological_position||0));
  }

  const api = {
    cleanText,
    normalizedUiText,
    normalizeWhatsAppMessageId,
    normalizedWhatsAppSystemText,
    isKnownWhatsAppSystemText,
    isKnownWhatsAppSystemEntry,
    removeKnownWhatsAppSystemMessages,
    audioDurationPriority,
    mergeEntryMetadata,
    messageHash,
    parsePrefix,
    continuationPrefix,
    playerDurationSeconds,
    normalizeEntry,
    mergeEntries,
    mergeMessageWindow,
    removeStaleAudioMarkers,
    isSyntheticAudioMessageId,
    pruneOrphanAudioEntries,
    consolidateAudioEntries,
    audioUnavailable,
    audioFileTimestamp,
    audioMatchCandidates
  };
  global.CriareWhatsAppCaptureCore = api;
  if(typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
