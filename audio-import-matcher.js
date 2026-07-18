(function(global){
  "use strict";

  const VERSION="2.2.0";
  const TIME_TOLERANCE_SECONDS=12*60*60;
  const UNAVAILABLE_STATES=["media_unavailable","legacy_unavailable","nao_localizado_no_dom","arquivo_inexistente"];
  const normalizeWhatsAppMessageId=value=>global.CriareWhatsAppCaptureCore.normalizeWhatsAppMessageId(value);
  const plain=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();

  function directionOf(entry){
    const sender=plain(entry?.sender);
    if(sender==="voce"||sender.includes("loja")||sender.includes("criare"))return "outgoing";
    const raw=plain(entry?.direction);
    if(/inbound|incoming|received|recebido/.test(raw))return "incoming";
    if(/outbound|outgoing|sent|enviado/.test(raw))return "outgoing";
    return "unknown";
  }

  function unavailableReason(entry){
    const state=[entry?.media_status,entry?.status,entry?.audioMeta?.extractionStatus,entry?.audioMeta?.error,entry?.text].map(plain).join(" ");
    const code=UNAVAILABLE_STATES.find(value=>state.includes(value));
    if(code)return code;
    if(state.includes("mensagem de midia indisponivel"))return "media_unavailable";
    return "";
  }

  function durationInfo(entry){
    const source=String(entry?.duration_source||entry?.audioMeta?.durationSource||"").trim();
    const confirmedSource=["whatsapp_player","confirmed","imported_file","audio_meta","message_duration"].includes(source);
    const confirmed=confirmedSource?Number(entry?.duration_seconds||entry?.duration||entry?.audioMeta?.durationSeconds||0):0;
    if(Number.isFinite(confirmed)&&confirmed>0&&confirmed<600)return {duration:confirmed,duration_seconds:confirmed,duration_valid:true,duration_source:source};
    const audioMeta=Number(entry?.audioMeta?.durationSeconds||0);
    if(!source&&Number.isFinite(audioMeta)&&audioMeta>0&&audioMeta<600)return {duration:audioMeta,duration_seconds:audioMeta,duration_valid:true,duration_source:"audio_meta"};
    const legacy=Number(entry?.duration_seconds||entry?.duration||entry?.audioMeta?.durationSeconds||0);
    if(Number.isFinite(legacy)&&legacy>0)return {duration:null,duration_seconds:null,duration_valid:false,duration_source:legacy>=600||source==="legacy_invalid"?"legacy_invalid":"unconfirmed",legacy_duration:legacy};
    return {duration:null,duration_seconds:null,duration_valid:false,duration_source:source||"missing"};
  }

  function isAudio(entry){return entry?.type==="Áudio"||entry?.hasVoiceMessage||Boolean(entry?.audioMeta)||/\[(?:audio sem transcricao|transcricao de audio)\]/.test(plain(entry?.text));}
  function transcriptOf(entry){const direct=String(entry?.transcript||entry?.audioMeta?.transcription||"").trim();if(direct)return direct;const match=String(entry?.text||"").match(/\[Transcrição de áudio\]\s*(.+)$/i);return String(match?.[1]||"").trim();}

  function buildInventory(entries){
    const candidates=(Array.isArray(entries)?entries:[]).filter(isAudio).map((entry,index)=>{
      const rawMessageId=String(entry?.message_id||entry?.id||"").trim();
      const normalizedMessageId=normalizeWhatsAppMessageId(rawMessageId);
      const duration=durationInfo(entry);const unavailable=unavailableReason(entry);const transcript=transcriptOf(entry);
      const transcriptionStatus=String(entry?.transcription_status||entry?.audioMeta?.transcriptionStatus||(transcript?"transcribed":"pending"));
      const candidate={
        entry,raw_message_id:rawMessageId,message_id:normalizedMessageId,normalized_message_id:normalizedMessageId,id:normalizedMessageId,
        position:Number.isFinite(Number(entry?.chronological_position))?Number(entry.chronological_position):index,
        visual_index:Number.isFinite(Number(entry?.visual_index))?Number(entry.visual_index):index,
        sender:String(entry?.sender||"").trim(),direction:directionOf(entry),date:String(entry?.date||"").trim(),
        message_time:String(entry?.message_time||entry?.time||"").trim(),time:String(entry?.message_time||entry?.time||"").trim(),
        duration_text:String(entry?.duration_text||"").trim(),...duration,
        media_status:unavailable||String(entry?.media_status||entry?.audioMeta?.extractionStatus||"pending"),
        transcript,transcription_status:transcriptionStatus,eligible:true,exclusion_reason:""
      };
      if(!normalizedMessageId){candidate.eligible=false;candidate.exclusion_reason="message_id_ausente";}
      else if(unavailable){candidate.eligible=false;candidate.exclusion_reason=unavailable;}
      else if(!candidate.duration_valid){candidate.eligible=false;candidate.exclusion_reason=candidate.duration_source==="legacy_invalid"?"duracao_legada_invalida":"duracao_nao_confirmada";}
      else if(!candidate.sender||candidate.direction==="unknown"||!candidate.date||!candidate.message_time){candidate.eligible=false;candidate.exclusion_reason="metadados_essenciais_ausentes";}
      return candidate;
    });
    const quality=candidate=>(global.CriareWhatsAppCaptureCore.audioDurationPriority(candidate.entry)*1000)+(candidate.duration_valid?100:0)+(candidate.sender?10:0)+(candidate.date?10:0)+(candidate.message_time?10:0)+(candidate.direction!=="unknown"?5:0)+(candidate.transcript?2:0);
    const byId=new Map();
    for(const candidate of candidates){const prior=byId.get(candidate.normalized_message_id);if(!prior||quality(candidate)>quality(prior))byId.set(candidate.normalized_message_id,candidate);}
    return [...byId.values()].sort((a,b)=>a.position-b.position||a.visual_index-b.visual_index);
  }

  function fileMetadata(file,index=0){
    const name=String(file?.name||"");const match=name.match(/(\d{4})[-_.](\d{2})[-_.](\d{2}).*?(\d{1,2})[.:_-](\d{2})(?:[.:_-](\d{2}))?/i);
    const timestamp=match?Date.UTC(+match[1],+match[2]-1,+match[3],+match[4],+match[5],+(match[6]||0)):null;
    return {name,size:Number(file?.size||0),format:String(file?.format||file?.extension||"").toLowerCase(),date:match?`${match[1]}-${match[2]}-${match[3]}`:"",time:match?`${match[4].padStart(2,"0")}:${match[5]}:${match[6]||"00"}`:"",timestamp,duration:Number(file?.duration||0)||null,import_order:Number.isFinite(Number(file?.import_order))?Number(file.import_order):index};
  }

  function messageTimestamp(candidate){const date=String(candidate.date||"").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);const time=String(candidate.message_time||candidate.time||"").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);return date&&time?Date.UTC(+date[3],+date[2]-1,+date[1],+time[1],+time[2],+(time[3]||0)):null;}
  function messageDateKey(candidate){const date=String(candidate.date||"").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);return date?`${date[3]}-${date[2].padStart(2,"0")}-${date[1].padStart(2,"0")}`:"";}
  const durationTolerance=seconds=>Math.max(2,Number(seconds||0)*.1);

  function evaluatePair(file,candidate,context={}){
    const reserved=context.reservedIds||new Set();const allowReplace=context.allowReplaceIds||new Set();const directionMode=context.directionMode||"";
    const reject=reason=>({...candidate,plausible:false,score:null,reasons:[],comparison_reason:reason,exclusion_reason:reason});
    if(!candidate.eligible)return reject(candidate.exclusion_reason||"audio_inelegivel");
    if(reserved.has(candidate.normalized_message_id))return reject("message_id_reservado");
    if(candidate.transcript&&!allowReplace.has(candidate.normalized_message_id))return reject("transcricao_existente");
    if(!["incoming","outgoing","both"].includes(directionMode))return reject("modo_de_importacao_nao_selecionado");
    if(directionMode!=="both"&&candidate.direction!==directionMode)return reject("direcao_incompativel");
    if(!file.duration)return reject("duracao_do_arquivo_nao_lida");
    const difference=Math.abs(file.duration-candidate.duration);const tolerance=durationTolerance(file.duration);
    if(difference>tolerance)return reject("duracao_fisicamente_incompativel");
    const dateKey=messageDateKey(candidate);if(file.date&&dateKey&&file.date!==dateKey)return reject("data_incompativel");
    const timestamp=messageTimestamp(candidate);const timeDifference=Number.isFinite(file.timestamp)&&Number.isFinite(timestamp)?Math.abs(file.timestamp-timestamp)/1000:null;
    if(Number.isFinite(file.timestamp)&&!Number.isFinite(timestamp))return reject("data_hora_da_mensagem_ausente");
    if(Number.isFinite(timeDifference)&&timeDifference>(context.timeToleranceSeconds||TIME_TOLERANCE_SECONDS))return reject("horario_fora_da_tolerancia");
    const durationQuality=Math.max(0,1-difference/tolerance);const timeQuality=Number.isFinite(timeDifference)?Math.max(0,1-timeDifference/(context.timeToleranceSeconds||TIME_TOLERANCE_SECONDS)):0;
    const fileRank=context.fileRanks?.get(file.import_order)??0;const candidateRank=context.candidateRanks?.get(candidate.normalized_message_id)??0;const rankSpan=Math.max(1,(context.fileCount||1)-1,(context.candidateCount||1)-1);const orderQuality=Math.max(0,1-Math.abs(fileRank-candidateRank)/rankSpan);
    const visualRank=context.visualRanks?.get(candidate.normalized_message_id)??candidateRank;const visualQuality=Math.max(0,1-Math.abs(fileRank-visualRank)/rankSpan);
    const reasons=["duração fisicamente compatível",directionMode==="both"?"direção aceita no modo Ambos":"direção compatível"];
    if(Number.isFinite(timeDifference))reasons.push("data/horário compatíveis");if(orderQuality>=.8)reasons.push("ordem cronológica compatível");if(visualQuality>=.8)reasons.push("posição visual compatível");
    const score=Math.round(55*durationQuality+25*timeQuality+10+5*orderQuality+5*visualQuality);
    return {...candidate,plausible:true,score,reasons,comparison_reason:"candidato plausível",duration_difference:difference,duration_tolerance:tolerance,time_difference_seconds:timeDifference};
  }

  function hungarianMax(weights){
    const n=weights.length;if(!n)return [];
    const originalColumns=Math.max(0,...weights.map(row=>row.length));const m=Math.max(originalColumns,n);const padded=weights.map(row=>[...row,...Array(Math.max(0,m-row.length)).fill(0)]);
    const maxWeight=Math.max(0,...padded.flat().filter(Number.isFinite));const u=Array(n+1).fill(0),v=Array(m+1).fill(0),p=Array(m+1).fill(0),way=Array(m+1).fill(0);
    for(let i=1;i<=n;i+=1){p[0]=i;let j0=0;const minv=Array(m+1).fill(Infinity),used=Array(m+1).fill(false);do{used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;for(let j=1;j<=m;j+=1){if(used[j])continue;const cost=maxWeight-padded[i0-1][j-1]-u[i0]-v[j];if(cost<minv[j]){minv[j]=cost;way[j]=j0;}if(minv[j]<delta){delta=minv[j];j1=j;}}for(let j=0;j<=m;j+=1){if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else minv[j]-=delta;}j0=j1;}while(p[j0]!==0);do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0!==0);}
    const assignment=Array(n).fill(-1);for(let j=1;j<=m;j+=1)if(p[j]&&j<=originalColumns)assignment[p[j]-1]=j-1;return assignment;
  }

  function matchFiles(files,inventory,options={}){
    const metadata=(Array.isArray(files)?files:[]).map(fileMetadata);const candidates=(Array.isArray(inventory)?inventory:[]).filter(item=>item.normalized_message_id);
    const chronologicalFiles=[...metadata].sort((a,b)=>(a.timestamp??Infinity)-(b.timestamp??Infinity)||a.name.localeCompare(b.name));const fileRanks=new Map(chronologicalFiles.map((file,index)=>[file.import_order,index]));
    const chronologicalCandidates=[...candidates].sort((a,b)=>a.position-b.position||a.visual_index-b.visual_index);const candidateRanks=new Map(chronologicalCandidates.map((item,index)=>[item.normalized_message_id,index]));const visualCandidates=[...candidates].sort((a,b)=>a.visual_index-b.visual_index||a.position-b.position);const visualRanks=new Map(visualCandidates.map((item,index)=>[item.normalized_message_id,index]));
    const context={...options,reservedIds:new Set(options.reservedMessageIds||[]),allowReplaceIds:new Set(options.allowReplaceIds||[]),fileRanks,candidateRanks,visualRanks,fileCount:metadata.length,candidateCount:candidates.length};
    const comparisons=metadata.map(file=>candidates.map(candidate=>evaluatePair(file,candidate,context)));
    const weights=comparisons.map(row=>row.map(pair=>pair.plausible?pair.score:-100000));const assignment=hungarianMax(weights);
    const results=metadata.map((file,fileIndex)=>{const ranked=comparisons[fileIndex].filter(pair=>pair.plausible).sort((a,b)=>b.score-a.score||a.position-b.position);const column=assignment[fileIndex];const assigned=column>=0&&comparisons[fileIndex][column]?.plausible?comparisons[fileIndex][column]:null;const secondBest=assigned?ranked.find(item=>item.normalized_message_id!==assigned.normalized_message_id):null;const margin=assigned?assigned.score-(secondBest?.score??0):0;const critical=Boolean(assigned?.normalized_message_id&&assigned?.sender&&assigned?.direction!=="unknown"&&assigned?.date&&assigned?.message_time&&assigned?.duration_valid);const autoSelect=Boolean(assigned&&assigned.score>=95&&critical&&margin>=10);return {file,comparisons:comparisons[fileIndex],ranked,top3:ranked.slice(0,3),assigned,margin,autoSelect};});
    return {files:metadata,inventory:candidates,results,assignments:results.map((result,index)=>({file_index:index,message_id:result.assigned?.normalized_message_id||null,score:result.assigned?.score??null,auto_select:result.autoSelect}))};
  }

  function compareFile(file,inventory,options={}){return matchFiles([file],inventory,options).results[0]||{file:fileMetadata(file),comparisons:[],ranked:[],top3:[],assigned:null,margin:0,autoSelect:false};}

  const api={version:VERSION,buildInventory,fileMetadata,messageTimestamp,durationTolerance,evaluatePair,hungarianMax,matchFiles,compareFile,durationInfo,directionOf,unavailableReason};
  global.CriareAudioImportMatcher=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
