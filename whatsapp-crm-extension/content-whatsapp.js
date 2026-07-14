"use strict";

const CRIARE_CONTENT_SCRIPT_VERSION = chrome.runtime.getManifest().version;
const CaptureCore = globalThis.CriareWhatsAppCaptureCore;
const {cleanText, normalizedUiText, messageHash, continuationPrefix} = CaptureCore;

function sleep(ms){ return new Promise(resolve=>setTimeout(resolve, ms)); }

const LOCAL_TRANSCRIBER_URL = "http://127.0.0.1:32123/v1/transcribe";
const AUDIO_MAX_BYTES = 15 * 1024 * 1024;
function voiceMessageNodes(main=activeMain()){return messageNodes(main).filter(node=>node.querySelector('[aria-label*="mensagem de voz" i],[aria-label*="voice message" i],[data-testid*="audio" i],audio'));}
function audioElement(node){return node.querySelector("audio")||null;}
function audioSource(node){const audio=audioElement(node);const candidates=[audio?.currentSrc,audio?.src,audio?.getAttribute("src"),node.querySelector("a[download],a[href*='blob:'],[data-url],[data-download-url]")?.getAttribute("href"),node.querySelector("[data-url],[data-download-url]")?.getAttribute("data-url")];return candidates.map(value=>String(value||"").trim()).find(value=>/^(blob:|data:|https?:)/i.test(value))||"";}
function audioDuration(node){const raw=Number(audioElement(node)?.duration);if(Number.isFinite(raw)&&raw>0)return Math.round(raw);const match=cleanText(node.innerText||"").match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);return match?Number(match[1])*60+Number(match[2]):null;}
function audioMeta(id,patch={}){return {messageId:id||null,durationSeconds:null,mimeType:null,sizeBytes:null,sha256:null,sourceAvailable:false,extractionStatus:"pending",transcriptionStatus:"pending",transcription:"",error:"",...patch};}
function publicAudioMeta(meta){if(!meta)return null;const {buffer,...safe}=meta;return safe;}
async function sha256Hex(buffer){const digest=await crypto.subtle.digest("SHA-256",buffer);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
function bytesToBase64(buffer){const bytes=new Uint8Array(buffer);let binary="";for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));return btoa(binary);}
async function extractAudioFile(node,id){
  const source=audioSource(node);const base=audioMeta(id,{source:source?(source.startsWith("blob:")?"blob":"url"):"none",durationSeconds:audioDuration(node)});
  if(!source){base.extractionStatus="unavailable";base.transcriptionStatus="unavailable";base.error="O WhatsApp não expôs o arquivo de áudio.";return base;}
  try{const response=await fetch(source,{credentials:"include",cache:"no-store"});if(!response.ok)throw new Error(`download_http_${response.status}`);const blob=await response.blob();if(!blob.size)throw new Error("arquivo_vazio");if(blob.size>AUDIO_MAX_BYTES)throw new Error("audio_maior_que_15mb");const buffer=await blob.arrayBuffer();const sha256=await sha256Hex(buffer);return {...base,sourceAvailable:true,extractionStatus:"extracted",mimeType:blob.type||"audio/ogg",sizeBytes:blob.size,sha256,buffer};}catch(error){return {...base,extractionStatus:"error",transcriptionStatus:"error",error:error.message||"Não foi possível obter o áudio."};}
}
async function transcribeLocally(meta){
  if(!meta?.buffer)return meta;
  try{const response=await fetch(LOCAL_TRANSCRIBER_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message_id:meta.messageId,sha256:meta.sha256,mime_type:meta.mimeType,duration_seconds:meta.durationSeconds,audio_base64:bytesToBase64(meta.buffer)})});const body=await response.json().catch(()=>({}));if(response.status===503||body?.code==="TRANSCRIBER_NOT_STARTED")return {...meta,transcriptionStatus:"pending",error:"Transcritor local não está iniciado."};if(!response.ok||!body?.text)return {...meta,transcriptionStatus:"error",error:body?.error||`transcritor_http_${response.status}`};return {...meta,transcriptionStatus:"completed",transcription:cleanText(body.text),error:""};}catch(error){return {...meta,transcriptionStatus:"pending",error:"Transcritor local não está iniciado."};}
}

function activeMain(){
  return document.querySelector("#main") || document.querySelector('main[role="main"]') || document.querySelector('[role="main"]');
}

function whatsappReadiness(){
  const count = selector => document.querySelectorAll(selector).length;
  const readyState = document.readyState;
  const qrCodeDetected = Boolean(document.querySelector('[data-testid="qrcode"],[data-ref] canvas,canvas[aria-label*="qr" i]'));
  const sidebarCount = count('#pane-side,[data-testid="chat-list"],[role="grid"]');
  const conversationListCount = count('#pane-side [role="listitem"],#pane-side [role="row"],[data-testid="chat-list"] [role="row"]');
  const searchCount = count('[data-testid="chat-list-search"],[data-testid="search"],#pane-side input[placeholder],#pane-side [contenteditable="true"][role="textbox"]');
  const main = activeMain();
  const panelCount = main ? 1 : 0;
  const headerCount = count('#main header,header[data-testid="conversation-header"],[data-testid="conversation-info-header-chat-title"]');
  const composerCount = count('#main [contenteditable="true"][role="textbox"],#main footer [contenteditable="true"],[data-testid="conversation-compose-box-input"]');
  const conversationListDetected = sidebarCount > 0 && conversationListCount > 0;
  const searchDetected = searchCount > 0;
  const panelDetected = panelCount > 0;
  const composerDetected = composerCount > 0;
  const headerDetected = headerCount > 0;
  const ready = ["interactive","complete"].includes(readyState);
  const connectedWithoutChat = ready && !qrCodeDetected && conversationListDetected && searchDetected;
  const connectedWithChat = ready && !qrCodeDetected && panelDetected && (headerDetected || composerDetected);
  let state = "interface_unrecognized";
  let message = "A interface do WhatsApp Web não foi reconhecida.";
  if(qrCodeDetected){ state = "login_required"; message = "Login necessário / QR Code detectado."; }
  else if(!ready){ state = "loading"; message = "WhatsApp Web ainda está carregando."; }
  else if(connectedWithChat){ state = "connected_with_open_chat"; message = "Conectado, conversa aberta."; }
  else if(connectedWithoutChat){ state = "connected_without_open_chat"; message = "Conectado, nenhuma conversa aberta."; }
  return {
    ok:true,
    connected:connectedWithoutChat || connectedWithChat,
    state,
    message,
    url:location.href,
    readyState,
    title:document.title,
    qrCodeDetected,
    conversationListDetected,
    panelDetected,
    composerDetected,
    headerDetected,
    counts:{sidebar:sidebarCount,conversationList:conversationListCount,search:searchCount,panel:panelCount,header:headerCount,composer:composerCount},
    mainFound:panelDetected,
    loggedIn:connectedWithoutChat || connectedWithChat,
    messageNodes:messageNodes(main).length
  };
}

function activeChatTitle(){
  const main = activeMain();
  const titled = main?.querySelector('header [data-testid="conversation-info-header-chat-title"]')
    || main?.querySelector('header span[dir="auto"]');
  return cleanText(titled?.textContent || titled?.getAttribute("title") || "");
}

function comparableText(value){
  return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameCustomer(title, request){
  const active = comparableText(title);
  const expectedName = comparableText(request?.customerName);
  const activeDigits = active.replace(/\D/g, "");
  const expectedDigits = String(request?.phone || "").replace(/\D/g, "");
  if(expectedDigits && activeDigits && activeDigits.endsWith(expectedDigits.slice(-10))) return true;
  const tokens = expectedName.split(" ").filter(token=>token.length >= 3);
  if(!tokens.length) return false;
  const activeTokens = active.split(" ").filter(Boolean);
  if(activeTokens[0] === tokens[0] && activeTokens.length <= 3) return true;
  return tokens.filter(token=>active.includes(token)).length >= Math.min(2, tokens.length);
}

function messageNodes(main=activeMain()){
  if(!main) return [];
  const current = [...main.querySelectorAll('[data-testid^="conv-msg-"]')]
    .filter(node=>node.querySelector('[data-testid="msg-container"]'));
  if(current.length) return current;
  const containers = [...main.querySelectorAll('[data-testid="msg-container"]')];
  const unique = new Set();
  return containers.map(node=>node.closest('[data-id]') || node.closest('[role="row"]') || node)
    .filter(node=>node && !unique.has(node) && unique.add(node));
}

function messageId(node){
  return cleanText((node.closest?.("[data-id]") || node.querySelector?.("[data-id]"))?.getAttribute("data-id") || "");
}

function windowSignature(main=activeMain()){
  const ids = messageNodes(main).map(messageId).filter(Boolean);
  return `${ids.length}:${ids.slice(0,3).join("|")}:${ids.slice(-3).join("|")}`;
}

async function waitForMessagesToSettle(main, {timeoutMs=12000,minWaitMs=1800}={}){
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let previous = "";
  let stable = 0;
  while(Date.now() < deadline){
    const current = windowSignature(main);
    stable = current && current === previous ? stable + 1 : 0;
    previous = current;
    if(messageNodes(main).length && stable >= 3 && Date.now() - startedAt >= minWaitMs) break;
    await sleep(450);
  }
  return messageNodes(main).length;
}

function olderMessagesButton(main=activeMain()){
  const phrases = [
    "clique neste aviso para carregar mensagens mais antigas do seu celular",
    "click this message to load older messages from your phone"
  ];
  return [...(main?.querySelectorAll("button,[role='button']") || [])].find(button=>{
    const text = normalizedUiText(button.textContent || button.getAttribute("aria-label"));
    return phrases.some(phrase=>text.includes(normalizedUiText(phrase)));
  }) || null;
}

async function loadOlderMessagesFromPhone(main){
  let attempts = 0;
  let loaded = false;
  const deadline = Date.now() + 60000;
  while(attempts < 8 && Date.now() < deadline){
    const button = olderMessagesButton(main);
    if(!button) break;
    attempts += 1;
    const before = windowSignature(main);
    button.click();
    const attemptDeadline = Math.min(deadline,Date.now() + 12000);
    let progressed = false;
    while(Date.now() < attemptDeadline){
      await sleep(600);
      const changed = windowSignature(main) !== before;
      const finished = !olderMessagesButton(main);
      if(changed || finished){ loaded = true; progressed = true; break; }
    }
    if(!olderMessagesButton(main)) break;
    if(!progressed) break;
  }
  return {requested:attempts > 0, loaded, attempts, pending:Boolean(olderMessagesButton(main))};
}

function profilePhotoUrl(main=activeMain()){
  const image = main?.querySelector('header[data-testid="conversation-header"] img') || main?.querySelector("header img");
  const source = String(image?.getAttribute("src") || "").trim();
  return /^(https:|data:image\/)/i.test(source) ? source : "";
}

function unavailablePhrases(){
  return [
    "o numero de telefone compartilhado atraves do link e invalido",
    "este numero de telefone nao esta no whatsapp",
    "phone number shared via url is invalid",
    "this phone number isnt on whatsapp",
    "this phone number is not on whatsapp"
  ];
}

function unavailableDialog(){
  return [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[data-animate-modal-popup="true"]')].find(node=>{
    const text = normalizedUiText(node.textContent);
    return unavailablePhrases().some(phrase=>text.includes(normalizedUiText(phrase)));
  }) || null;
}

function conversationUnavailable(){
  if(unavailableDialog()) return true;
  if(activeMain()) return false;
  const text = normalizedUiText(document.body?.innerText || "");
  return unavailablePhrases().some(phrase=>text.includes(normalizedUiText(phrase)));
}

function dismissUnavailableDialog(){
  const dialog = unavailableDialog();
  if(!dialog) return false;
  const buttons = [...dialog.querySelectorAll("button,[role='button']")];
  const preferred = buttons.find(button=>/^(ok|entendi|fechar|close)$/i.test(cleanText(button.textContent))) || buttons.at(-1);
  if(!preferred) return false;
  preferred.click();
  return true;
}

function chatLoadState(request={}){
  const main = activeMain();
  if(!main) return {ready:false,title:"",count:0,unavailable:conversationUnavailable()};
  const title = activeChatTitle();
  const count = messageNodes(main).length;
  const payload={
    ready:Boolean(title && count), empty:Boolean(title && !count), title, count,
    matches:sameCustomer(title, request), profilePhotoUrl:profilePhotoUrl(main),
    olderMessagesAvailable:Boolean(olderMessagesButton(main)), unavailable:conversationUnavailable()
  };
  return payload;
}

function mediaType(node){
  if(node.querySelector('[data-testid*="audio" i],audio,[aria-label*="mensagem de voz" i],[aria-label*="voice message" i]')) return "Áudio";
  if(node.querySelector('[data-testid*="document" i],[aria-label*="documento" i],[aria-label*="document" i]')) return "Documento";
  if(node.querySelector('[data-testid*="video" i],video,[aria-label*="vídeo" i],[aria-label*="video" i]')) return "Vídeo";
  if(node.querySelector('[data-testid*="location" i],a[href*="maps.google"],a[aria-label*="localização" i]')) return "Localização";
  if(node.querySelector('[data-testid*="contact" i],[aria-label*="contato" i]')) return "Contato";
  if(node.querySelector('[data-testid*="sticker" i]')) return "Figurinha";
  if(node.querySelector('[data-testid="image-thumb"],[aria-label*="abrir imagem" i]')) return "Imagem";
  return "";
}

function visibleTime(node){
  const lines = cleanText(node.innerText || "").split("\n").map(cleanText).filter(Boolean);
  const candidate = lines.reverse().find(line=>/^(?:editada\s*)?\d{1,2}:\d{2}/i.test(line));
  return cleanText(candidate?.match(/\d{1,2}:\d{2}/)?.[0] || "");
}

function explicitAuthor(node){
  const label = [...node.querySelectorAll('[aria-label$=":"]')].map(item=>cleanText(item.getAttribute("aria-label"))).find(Boolean);
  return cleanText(label).replace(/:\s*$/, "");
}

function messageBody(node,audioState=new Map()){
  const type = mediaType(node);
  if(type === "Áudio"){
    const id=messageId(node)||`fp:${messageHash(cleanText(node.innerText||"audio"))}`;const audio=audioState.get(id)||audioMeta(id);
    return {body:audio.transcription?`[Transcrição de áudio] ${audio.transcription}`:"[Áudio sem transcrição]",type,audioTranscribed:Boolean(audio.transcription),audioMeta:publicAudioMeta(audio)};
  }
  const detail = node.querySelector("[data-pre-plain-text]");
  const selectableText = [...node.querySelectorAll("span.selectable-text")]
    .map(item=>cleanText(item.innerText || item.textContent || "")).filter(Boolean).join("\n");
  const clone = (detail || node.querySelector('[data-testid="msg-container"]') || node).cloneNode(true);
  clone.querySelectorAll('button[aria-label="Mensagem citada"],[data-testid*="quoted" i],[data-testid*="reaction" i],.wt-btn-container,.parakeet-wa-transcribe-container').forEach(item=>item.remove());
  clone.querySelectorAll('span[aria-label$=":"]').forEach(item=>item.remove());
  let text = selectableText || cleanText(clone.innerText || clone.textContent || "");
  text = text.split("\n").filter(line=>{
    const value = cleanText(line);
    return value && !/^(?:editada\s*)?\d{1,2}:\d{2}(?:\s+(?:lida|entregue|enviada))?$/i.test(value);
  }).join("\n");
  if(type === "Localização"){
    const address = cleanText(node.querySelector('[data-testid="location-msg"]')?.textContent || text);
    text = address;
  }
  if(type && !text) text = `[${type}]`;
  else if(type && !text.startsWith(`[${type}]`)) text = `[${type}] ${text}`;
  return {body:text || "[Mensagem sem texto]",type:type || "Texto",audioTranscribed:false};
}

function readVisibleMessageWindow(main,audioState=new Map()){
  const occurrences = new Map();
  const entries = [];
  let previousPrefix = "";
  for(const node of messageNodes(main)){
    const detail = node.querySelector("[data-pre-plain-text]");
    let prefix = cleanText(detail?.getAttribute("data-pre-plain-text"));
    if(!prefix) prefix = continuationPrefix(previousPrefix, visibleTime(node), explicitAuthor(node));
    previousPrefix = prefix || previousPrefix;
    const message = messageBody(node,audioState);
    const text = cleanText(`${prefix}${prefix && !prefix.endsWith(" ") ? " " : ""}${message.body}`);
    if(!text) continue;
    const stableId = messageId(node);
    const fingerprint = messageHash(text);
    const occurrence = occurrences.get(fingerprint) || 0;
    occurrences.set(fingerprint, occurrence + 1);
    entries.push({
      id:stableId ? `wa:${stableId}` : `fp:${fingerprint}:${occurrence}`,
      text,
      type:message.type,
      hasVoiceMessage:message.type === "Áudio",
      audioTranscribed:message.audioTranscribed,
      audioMeta:message.audioMeta||null,
      capturedAt:new Date().toISOString()
    });
  }
  return entries;
}

function mergeWindow(currentEntries, visibleEntries){
  const currentById = new Map(currentEntries.map((entry,index)=>[entry.id,index]));
  const older = [];
  for(const entry of visibleEntries){
    if(currentById.has(entry.id)){
      currentEntries[currentById.get(entry.id)] = entry;
      continue;
    }
    older.push(entry);
  }
  return {entries:[...older,...currentEntries],added:older.length};
}

function messageScrollContainer(main){
  return main.querySelector('[data-testid="conversation-panel-messages"]')
    || [...main.querySelectorAll("div")].find(element=>{
      const style = getComputedStyle(element);
      return /auto|scroll/i.test(style.overflowY) && element.scrollHeight > element.clientHeight + 200;
    }) || null;
}

async function collectAvailableHistory(main,{maximum=10000,timeoutMs=120000}={}){
  const audioState=new Map();let entries = readVisibleMessageWindow(main,audioState);
  const deadline = Date.now() + timeoutMs;
  let scrollPasses = 0;
  let stableTopPasses = 0;
  let reachedStart = false;
  let loadedStartReached = false;

  while(Date.now() < deadline && entries.length < maximum && scrollPasses < 220){
    const scroller = messageScrollContainer(main);
    if(!scroller){ loadedStartReached = true; reachedStart = !olderMessagesButton(main); break; }
    const beforeSignature = windowSignature(main);
    const beforeTop = scroller.scrollTop;
    scroller.scrollTop = Math.max(0, beforeTop - Math.max(scroller.clientHeight * 0.85, 700));
    scroller.dispatchEvent(new Event("scroll",{bubbles:true}));
    await sleep(550);
    await waitForMessagesToSettle(main,{timeoutMs:3500,minWaitMs:450});
    const merged = mergeWindow(entries, readVisibleMessageWindow(main,audioState));
    entries = merged.entries;
    scrollPasses += 1;
    const atTop = scroller.scrollTop <= 2;
    const unchanged = beforeSignature === windowSignature(main) && merged.added === 0;
    stableTopPasses = atTop && unchanged ? stableTopPasses + 1 : 0;
    if(atTop && stableTopPasses >= 2){
      loadedStartReached = true;
      reachedStart = !olderMessagesButton(main);
      break;
    }
  }

  const limited = entries.length >= maximum || (!loadedStartReached && Date.now() >= deadline);
  if(entries.length > maximum) entries = entries.slice(-maximum);
  const scroller = messageScrollContainer(main);
  if(scroller){ scroller.scrollTop = scroller.scrollHeight; scroller.dispatchEvent(new Event("scroll",{bubbles:true})); }
  return {entries,reachedStart,loadedStartReached,scrollPasses,limited,audioState};
}

async function processAudioQueue(main,request,history){
  const voices=voiceMessageNodes(main);if(!voices.length)return;
  for(const node of voices){
    const id=messageId(node)||`fp:${messageHash(cleanText(node.innerText||"audio"))}`;const entry=history.entries.find(item=>item.id===`wa:${id}`||item.id===id||item.text.includes("[Áudio"));if(!entry)continue;
    let meta=await extractAudioFile(node,id);if(meta.extractionStatus==="extracted")meta=await transcribeLocally(meta);
    const transcript=cleanText(meta.transcription||"");const text=transcript?entry.text.replace("[Áudio sem transcrição]",`[Transcrição de áudio] ${transcript}`):entry.text;
    chrome.runtime.sendMessage({type:"criare-audio-transcription-complete",request:{phone:request?.phone||"",customerName:request?.customerName||""},entry:{...entry,text,audioMeta:publicAudioMeta(meta),audioTranscribed:Boolean(transcript),hasVoiceMessage:true}}).catch(()=>{});
  }
}
async function extractLoadedMessages(request={}){
  const main = activeMain();
  if(!main) throw new Error("Abra uma conversa no WhatsApp Web antes de capturar.");
  await waitForMessagesToSettle(main);
  const olderHistory = await loadOlderMessagesFromPhone(main);
  if(olderHistory.requested) await waitForMessagesToSettle(main,{timeoutMs:18000,minWaitMs:2500});
  const loadedScroller = messageScrollContainer(main);
  if(loadedScroller){
    loadedScroller.scrollTop = loadedScroller.scrollHeight;
    loadedScroller.dispatchEvent(new Event("scroll",{bubbles:true}));
    await waitForMessagesToSettle(main,{timeoutMs:8000,minWaitMs:900});
  }
  const history = await collectAvailableHistory(main);
  if(!history.entries.length) throw new Error("Não encontrei mensagens carregadas nesta conversa.");
  const audioCount = history.entries.filter(entry=>entry.hasVoiceMessage).length;
  const audioTranscribed = history.entries.filter(entry=>entry.audioTranscribed).length;
  const payload={
    transcript:history.entries.map(entry=>entry.text).join("\n"),
    entries:history.entries.map(({id,text,type,capturedAt,hasVoiceMessage,audioTranscribed,audioMeta})=>({id,text,type,capturedAt,hasVoiceMessage,audioTranscribed,audioMeta})),
    count:history.entries.length,audioCount,audioTranscribed,
    audioExtensionDetected:false,
    olderHistoryRequested:olderHistory.requested,
    olderHistoryLoaded:olderHistory.loaded,
    olderHistoryPending:olderHistory.pending,
    reachedStart:history.reachedStart && !olderHistory.pending,
    loadedHistoryComplete:history.loadedStartReached && !history.limited,
    scrollPasses:history.scrollPasses,
    profilePhotoUrl:profilePhotoUrl(main),limited:history.limited
  };
  // A fila em lote precisa concluir texto e gravação sem depender de áudio local.
  if(!request?.disableAudio) queueMicrotask(()=>processAudioQueue(main,request,history).catch(()=>{}));
  return payload;
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type === "criare-content-script-status"){
    sendResponse({ok:true,contentScriptVersion:CRIARE_CONTENT_SCRIPT_VERSION});
    return false;
  }
  if(message?.type === "criare-prepare-next-chat"){
    sendResponse({ok:true,dismissed:dismissUnavailableDialog(),contentScriptVersion:CRIARE_CONTENT_SCRIPT_VERSION});
    return false;
  }
  if(message?.type === "criare-whatsapp-readiness"){
    sendResponse({contentScriptVersion:CRIARE_CONTENT_SCRIPT_VERSION,...whatsappReadiness()});
    return false;
  }
  if(message?.type === "criare-chat-load-state"){
    sendResponse({ok:true,contentScriptVersion:CRIARE_CONTENT_SCRIPT_VERSION,...chatLoadState(message.request || {})});
    return false;
  }
  if(message?.type !== "criare-extract-active-chat") return false;
  (async()=>{
    try{
      const title = activeChatTitle();
      if(!sameCustomer(title,message.request || {})){
        throw new Error(`A conversa aberta é “${title || "não identificada"}”, mas o cliente solicitado é “${cleanText(message.request?.customerName) || "o lead do CRM"}”.`);
      }
      sendResponse({ok:true,title,contentScriptVersion:CRIARE_CONTENT_SCRIPT_VERSION,...await extractLoadedMessages(message.request || {})});
    }catch(error){
      sendResponse({ok:false,contentScriptVersion:CRIARE_CONTENT_SCRIPT_VERSION,error:error.message || "Não foi possível ler a conversa aberta."});
    }
  })();
  return true;
});
