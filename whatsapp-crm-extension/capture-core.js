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

  function mergeEntryMetadata(stored,incoming){
    const canonical=normalizeWhatsAppMessageId(incoming?.message_id||incoming?.id||stored?.message_id||stored?.id);
    if(!isAudioEntry(stored)&&!isAudioEntry(incoming))return {...stored,...incoming,...(canonical?{message_id:canonical}:{})};
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
    audioDurationPriority,
    mergeEntryMetadata,
    messageHash,
    parsePrefix,
    continuationPrefix,
    playerDurationSeconds,
    normalizeEntry,
    mergeEntries,
    mergeMessageWindow,
    audioUnavailable,
    audioFileTimestamp,
    audioMatchCandidates
  };
  global.CriareWhatsAppCaptureCore = api;
  if(typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
