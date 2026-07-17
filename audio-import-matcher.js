(function(global){
  "use strict";

  const VERSION = "2.1.18";
  const UNAVAILABLE_STATES = ["media_unavailable","legacy_unavailable","nao_localizado_no_dom","arquivo_inexistente"];

  function plain(value){
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function directionOf(entry){
    const raw = plain(entry?.direction);
    if(/inbound|incoming|received|recebido/.test(raw)) return "incoming";
    if(/outbound|outgoing|sent|enviado/.test(raw)) return "outgoing";
    return "unknown";
  }

  function unavailableReason(entry){
    const state = [entry?.media_status,entry?.status,entry?.audioMeta?.extractionStatus,entry?.audioMeta?.transcriptionStatus,entry?.audioMeta?.error,entry?.text].map(plain).join(" ");
    const code = UNAVAILABLE_STATES.find(value=>state.includes(value));
    if(code) return code;
    if(state.includes("mensagem de midia indisponivel")) return "media_unavailable";
    return "";
  }

  function durationInfo(entry){
    const direct = Number(entry?.duration || 0);
    const audioMeta = Number(entry?.audioMeta?.durationSeconds || 0);
    const value = direct > 0 ? direct : audioMeta;
    if(!Number.isFinite(value) || value <= 0) return {duration:null,duration_valid:false,duration_source:"missing"};
    if(value > 600) return {duration:value,duration_valid:false,duration_source:"legacy_invalid"};
    return {duration:value,duration_valid:true,duration_source:direct > 0 ? "message_duration" : "audio_meta"};
  }

  function isAudio(entry){
    return entry?.type === "Áudio" || entry?.hasVoiceMessage || Boolean(entry?.audioMeta) || /\[(?:audio sem transcricao|transcricao de audio)\]/.test(plain(entry?.text));
  }

  function buildInventory(entries){
    return (Array.isArray(entries) ? entries : []).filter(isAudio).map((entry,index)=>{
      const duration = durationInfo(entry);
      const reason = unavailableReason(entry);
      const candidate = {
        entry,
        message_id:String(entry?.message_id || entry?.id || "").trim(),
        id:String(entry?.id || entry?.message_id || "").trim(),
        sender:String(entry?.sender || "").trim(),
        direction:directionOf(entry),
        date:String(entry?.date || "").trim(),
        time:String(entry?.time || "").trim(),
        status:reason || String(entry?.audioMeta?.extractionStatus || entry?.status || "pending"),
        position:Number.isFinite(Number(entry?.chronological_position)) ? Number(entry.chronological_position) : index,
        ...duration,
        eligible:!reason,
        exclusion_reason:reason
      };
      const hasAnyMetadata=Boolean(candidate.sender || candidate.date || candidate.time || candidate.duration_valid || candidate.direction !== "unknown");
      if(candidate.eligible && !hasAnyMetadata){candidate.eligible=false;candidate.exclusion_reason="metadados_essenciais_ausentes";}
      return candidate;
    });
  }

  function fileMetadata(file){
    const name=String(file?.name || "");
    const match=name.match(/(\d{4})[-_.](\d{2})[-_.](\d{2}).*?(\d{1,2})[.:_-](\d{2})(?:[.:_-](\d{2}))?/i);
    const timestamp=match ? Date.UTC(+match[1],+match[2]-1,+match[3],+match[4],+match[5],+(match[6]||0)) : null;
    return {name,date:match?`${match[1]}-${match[2]}-${match[3]}`:"",time:match?`${match[4].padStart(2,"0")}:${match[5]}:${match[6]||"00"}`:"",timestamp,duration:Number(file?.duration || 0) || null,assumed_direction:"incoming"};
  }

  function messageTimestamp(candidate){
    const date=candidate.date.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);const time=candidate.time.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return date&&time ? Date.UTC(+date[3],+date[2]-1,+date[1],+time[1],+time[2],+(time[3]||0)) : null;
  }

  function compareFile(file,inventory,{fileIndex=0,fileCount=1}={}){
    const metadata=fileMetadata(file);const eligible=inventory.filter(candidate=>candidate.eligible).sort((a,b)=>a.position-b.position);
    const comparisons=inventory.map(candidate=>{
      if(!candidate.eligible)return {...candidate,score:null,confidence_cap:null,reasons:[],comparison_reason:candidate.exclusion_reason};
      let score=0;const reasons=[];const timestamp=messageTimestamp(candidate);
      if(Number.isFinite(metadata.timestamp)&&Number.isFinite(timestamp)){const quality=Math.max(0,1-Math.abs(metadata.timestamp-timestamp)/1000/(12*60*60));score+=40*quality;if(quality>=.8)reasons.push("horário compatível");}
      if(metadata.duration&&candidate.duration_valid){const quality=Math.max(0,1-Math.abs(metadata.duration-candidate.duration)/20);score+=35*quality;if(quality>=.8)reasons.push("duração compatível");}
      if(candidate.direction===metadata.assumed_direction){score+=15;reasons.push("lado da conversa compatível");}
      const eligibleIndex=eligible.findIndex(item=>item.id===candidate.id);
      if(fileCount>1&&eligible.length>1&&eligibleIndex>=0){const expectedRank=Math.round(fileIndex/(fileCount-1)*(eligible.length-1));const quality=Math.max(0,1-Math.abs(eligibleIndex-expectedRank)/Math.max(1,eligible.length-1));score+=10*quality;if(quality>=.8)reasons.push("sequência cronológica compatível");}
      if(candidate.direction==="outgoing"){score*=.3;reasons.push("penalidade: áudio enviado pela loja");}
      const complete=Boolean(candidate.sender&&candidate.date&&candidate.time&&candidate.duration_valid);
      const confidence_cap=complete?100:60;score=Math.min(confidence_cap,Math.round(score));
      return {...candidate,score,confidence_cap,reasons,comparison_reason:complete?"metadados completos":"confiança limitada por metadados ausentes"};
    });
    const ranked=comparisons.filter(candidate=>candidate.eligible).sort((a,b)=>b.score-a.score||a.position-b.position);
    return {file:metadata,comparisons,ranked,top3:ranked.slice(0,3)};
  }

  const api={version:VERSION,buildInventory,fileMetadata,compareFile,durationInfo,directionOf,unavailableReason};
  global.CriareAudioImportMatcher=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
