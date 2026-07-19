"use strict";

const CRIARE_CONTENT_SCRIPT_VERSION = chrome.runtime.getManifest().version;
const CaptureCore = globalThis.CriareWhatsAppCaptureCore;
const {cleanText, normalizedUiText, normalizeWhatsAppMessageId, messageHash, continuationPrefix, playerDurationSeconds} = CaptureCore;

function sleep(ms){ return new Promise(resolve=>setTimeout(resolve, ms)); }

const LOCAL_TRANSCRIBER_URL = "http://127.0.0.1:32123/v1/transcribe";
const AUDIO_MAX_BYTES = 15 * 1024 * 1024;
function voiceMessageNodes(main=activeMain()){return messageNodes(main).filter(node=>node.querySelector('[aria-label*="mensagem de voz" i],[aria-label*="voice message" i],[data-testid*="audio" i],audio'));}
function audioElement(node){return node.querySelector("audio")||null;}
function audioSource(node){const audio=audioElement(node);const candidates=[audio?.currentSrc,audio?.src,audio?.getAttribute("src"),node.querySelector("a[download],a[href*='blob:'],[data-url],[data-download-url]")?.getAttribute("href"),node.querySelector("[data-url],[data-download-url]")?.getAttribute("data-url")];return candidates.map(value=>String(value||"").trim()).find(value=>/^(blob:|data:|https?:)/i.test(value))||"";}
function audioDurationText(node){
  // O horário da mensagem fica fora do player. Só aceitamos nós-folha que
  // pertencem ao controle de áudio; nunca usamos o texto completo da bolha.
  for(const leaf of node.querySelectorAll("span,div")){
    if(leaf.children.length||leaf.closest("[data-pre-plain-text]")||leaf.closest("time"))continue;
    const text=cleanText(leaf.textContent||"");
    const insidePlayer=Boolean(leaf.parentElement?.querySelector('button[aria-label*="mensagem de voz" i],button[aria-label*="voice message" i],[role="slider"][aria-label*="voz" i],[role="slider"][aria-label*="voice" i]'));
    if(insidePlayer&&/^\d+:\d{2}(?::\d{2})?$/.test(text))return text;
  }
  const players=[...node.querySelectorAll('[data-testid*="audio" i],[aria-label*="mensagem de voz" i],[aria-label*="voice message" i],audio')];
  const sources=[];
  for(const player of players){
    sources.push({value:player.getAttribute?.("aria-label")||"",aria:true});
    for(const child of player.querySelectorAll?.("span,div")||[]){
      if(child.children.length||child.closest("[data-pre-plain-text]")||child.closest("time"))continue;
      sources.push({value:child.textContent||"",aria:false});
    }
  }
  for(const source of sources){const text=cleanText(source.value||"");const match=source.aria?text.match(/(?:mensagem de voz|voice message|duraç[aã]o|duration)[^\d]*(\d+):(\d{2})(?::(\d{2}))?/i):text.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);if(match)return match[3]?`${match[1]}:${match[2]}:${match[3]}`:`${match[1]}:${match[2]}`;}
  return "";
}
function audioDuration(node){const raw=Number(audioElement(node)?.duration);if(Number.isFinite(raw)&&raw>0)return Math.round(raw);const value=audioDurationText(node).match(/^(\d+):(\d{2})(?::(\d{2}))?$/);return value?(value[3]?Number(value[1])*3600+Number(value[2])*60+Number(value[3]):Number(value[1])*60+Number(value[2])):null;}
function audioMeta(id,patch={}){return {messageId:id||null,durationSeconds:null,mimeType:null,sizeBytes:null,sha256:null,sourceAvailable:false,extractionStatus:"pending",transcriptionStatus:"pending",transcription:"",error:"",...patch};}
function publicAudioMeta(meta){if(!meta)return null;const {buffer,...safe}=meta;return safe;}
async function sha256Hex(buffer){const digest=await crypto.subtle.digest("SHA-256",buffer);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
function bytesToBase64(buffer){const bytes=new Uint8Array(buffer);let binary="";for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));return btoa(binary);}
async function extractAudioFile(node,id,sourceOverride=""){
  const source=String(sourceOverride||audioSource(node)||"");const base=audioMeta(id,{source:source?(source.startsWith("blob:")?"blob":"url"):"none",durationSeconds:audioDuration(node)});
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
  // A lista lateral é suficiente para comprovar uma sessão conectada. O campo de
  // busca varia entre versões do WhatsApp e pode não existir antes do primeiro chat.
  const connectedWithoutChat = ready && !qrCodeDetected && conversationListDetected;
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
  const activeDigits = active.replace(/\D/g, "");
  const expectedDigits = globalThis.CriarePhoneIdentity.comparableDigits(request?.phone);
  if(expectedDigits && activeDigits && activeDigits.endsWith(expectedDigits.slice(-10))) return true;
  const routedPhone = new URL(location.href).searchParams.get("phone") || "";
  const routedDigits = globalThis.CriarePhoneIdentity.comparableDigits(`+${routedPhone}`);
  return Boolean(expectedDigits && (routedDigits===expectedDigits || request?.phoneNavigationConfirmed===true));
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

function conversationOpenState(request={}){
  const main = activeMain();
  if(conversationUnavailable()) return {ready:false,code:"contact_not_found",error:"Contato não localizado no WhatsApp."};
  if(!main) return {ready:false,code:"panel_not_created",error:"O painel principal da conversa não foi criado."};
  const title = activeChatTitle();
  if(!title) return {ready:false,code:"header_not_found",error:"O cabeçalho da conversa não foi identificado."};
  const container = main.querySelector('[data-testid="conversation-panel-messages"],[data-testid="msg-container"],[data-id]');
  if(!container) return {ready:false,code:"messages_not_loaded",error:"O container de mensagens não foi carregado.",title};
  if(!sameCustomer(title,request)) return {ready:false,code:"contact_mismatch",error:"O contato aberto é diferente do lead solicitado.",title};
  return {ready:true,title,count:messageNodes(main).length,signature:`${title}:${messageNodes(main).length}`,profilePhotoUrl:profilePhotoUrl(main)};
}

function sidebarConversationRows(){
  const selectors = [
    '#pane-side [role="listitem"]',
    '#pane-side [role="row"]',
    '[data-testid="chat-list"] [role="row"]',
    '[data-testid="chat-list"] [role="listitem"]'
  ];
  return [...new Set(selectors.flatMap(selector=>[...document.querySelectorAll(selector)]))];
}

function sidebarSearchControl(){
  return document.querySelector([
    '#pane-side input',
    '#pane-side [contenteditable="true"][role="textbox"]',
    '#pane-side [contenteditable="true"]',
    '[data-testid="chat-list-search"] input',
    '[data-testid="chat-list-search"] [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"][aria-placeholder*="Pesquisar" i]',
    '[contenteditable="true"][role="textbox"][aria-label*="Pesquisar" i]',
    'input[placeholder*="Pesquisar" i]',
    '[contenteditable="true"][role="textbox"][data-tab="3"]'
  ].join(','));
}

function sidebarRowMatches(row,request={}){
  const rowText = comparableText(row?.innerText || row?.textContent || "");
  const phone = globalThis.CriarePhoneIdentity.comparableDigits(request?.phone);
  const rowDigits = rowText.replace(/\D/g,"");
  if(phone && rowDigits.includes(phone.slice(-8))) return true;
  return false;
}

function setSidebarSearchValue(control,value){
  control.focus();
  if(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement){
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control),"value");
    descriptor?.set?.call(control,value);
  }else{
    control.textContent = value;
  }
  control.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:value}));
  control.dispatchEvent(new Event("change",{bubbles:true}));
}

async function openConversationFromSidebar(request={}){
  const findRow = () => sidebarConversationRows().find(row=>sidebarRowMatches(row,request));
  let row = findRow();
  if(!row){
    const search = sidebarSearchControl();
    if(!search) return {ok:false,code:"sidebar_search_not_found",error:"A busca da lista lateral não foi localizada para abrir o primeiro contato."};
    setSidebarSearchValue(search,globalThis.CriarePhoneIdentity.comparableDigits(request.phone));
    for(let attempt=0;attempt<20&&!row;attempt+=1){
      await sleep(350);
      row = findRow();
      if(!row){const rows=sidebarConversationRows().filter(candidate=>candidate.offsetWidth>0&&candidate.offsetHeight>0);if(rows.length===1)row=rows[0];}
    }
  }
  if(!row) return {ok:false,code:"contact_not_found",error:"Contato não localizado na lista lateral do WhatsApp."};
  row.scrollIntoView({block:"center"});
  row.click();
  return {ok:true,code:"sidebar_contact_opened"};
}

function waitForConversationStable(request={}, {timeoutMs=65000}={}){
  return new Promise(resolve=>{
    const deadline = Date.now() + timeoutMs;
    let observer = null;
    let timer = null;
    let interval = null;
    let queued = false;
    let stableChecks = 0;
    let previousSignature = "";
    let lastState = null;
    const finish = result => {
      if(observer) observer.disconnect();
      if(timer) clearTimeout(timer);
      if(interval) clearInterval(interval);
      resolve(result);
    };
    const inspect = () => {
      queued = false;
      const state = conversationOpenState(request);
      lastState = state;
      if(["contact_not_found","contact_mismatch"].includes(state.code)) return finish(state);
      if(state.ready){
        stableChecks = state.signature === previousSignature ? stableChecks + 1 : 0;
        previousSignature = state.signature;
        if(stableChecks >= 2) return finish(state);
      }else{
        stableChecks = 0;
        previousSignature = "";
      }
      if(Date.now() >= deadline) finish({...lastState,ready:false,code:lastState?.code||"spa_timeout",error:lastState?.error||"Tempo esgotado na transição interna do WhatsApp Web."});
    };
    const schedule = () => { if(!queued){ queued = true; setTimeout(inspect,120); } };
    observer = new MutationObserver(schedule);
    observer.observe(document.body || document.documentElement,{childList:true,subtree:true,attributes:true});
    interval = setInterval(inspect,450);
    timer = setTimeout(()=>finish({...lastState,ready:false,code:lastState?.code||"spa_timeout",error:lastState?.error||"Tempo esgotado na transição interna do WhatsApp Web."}),timeoutMs);
    inspect();
  });
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

function messageDirection(node){return /message-out|outgoing|outbound/i.test(`${node.className||""} ${node.closest?.("[class]")?.className||""}`)?"outbound":"inbound";}
function canonicalAudioDirection(sender,detected){const value=normalizedUiText(sender);if(value==="voce"||value.includes("loja")||value.includes("criare"))return "outbound";return detected;}
function prefixParts(prefix){const match=cleanText(prefix).match(/^\[([^,\]]+),\s*([^\]]+)\]\s*([^:]+):/);return {time:cleanText(match?.[1]||""),date:cleanText(match?.[2]||""),sender:cleanText(match?.[3]||"")};}
function audioEntryId(node,prefix,position){
  const original=messageId(node);if(original)return `wa:${original}`;
  const parts=prefixParts(prefix);const duration=audioDuration(node)||"sem-duracao";
  return `audio:${messageHash(`${parts.sender}|${parts.date}|${parts.time}|${duration}|${position}|${messageDirection(node)}`)}`;
}
function messageBody(node,audioState=new Map(),audioId=""){
  const type = mediaType(node);
  if(type === "Áudio"){
    const id=audioId||audioEntryId(node,"",0);const audio=audioState.get(id)||audioMeta(id);
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
  for(const [position,node] of messageNodes(main).entries()){
    const detail = node.querySelector("[data-pre-plain-text]");
    let prefix = cleanText(detail?.getAttribute("data-pre-plain-text"));
    if(!prefix) prefix = continuationPrefix(previousPrefix, visibleTime(node), explicitAuthor(node));
    previousPrefix = prefix || previousPrefix;
    const type=mediaType(node);const entryId=type==="Áudio"?audioEntryId(node,prefix,position):"";
    const message = messageBody(node,audioState,entryId);
    const text = cleanText(`${prefix}${prefix && !prefix.endsWith(" ") ? " " : ""}${message.body}`);
    if(!text) continue;
    const stableId = messageId(node);
    const fingerprint = messageHash(text);
    const occurrence = occurrences.get(fingerprint) || 0;
    occurrences.set(fingerprint, occurrence + 1);
    entries.push({
      id:type==="Áudio"?entryId:(stableId ? `wa:${stableId}` : `fp:${fingerprint}:${occurrence}`),
      text,
      type:message.type,
      hasVoiceMessage:message.type === "Áudio",
      audioTranscribed:message.audioTranscribed,
      audioMeta:message.audioMeta||null,
      message_id:stableId||null,
      sender:prefixParts(prefix).sender||null,
      direction:messageDirection(node),
      date:prefixParts(prefix).date||null,
      time:prefixParts(prefix).time||null,
      duration:message.type==="Áudio"?audioDuration(node):null,
      chronological_position:position,
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
  for(const [position,node] of voices.entries()){
    const detail=node.querySelector("[data-pre-plain-text]");const prefix=cleanText(detail?.getAttribute("data-pre-plain-text"))||"";const id=audioEntryId(node,prefix,position);const entry=history.entries.find(item=>item.id===id);if(!entry)continue;
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
    entries:history.entries.map(({id,text,type,capturedAt,hasVoiceMessage,audioTranscribed,audioMeta,message_id,sender,direction,date,time,duration,chronological_position})=>({id,text,type,capturedAt,hasVoiceMessage,audioTranscribed,audioMeta,message_id,sender,direction,date,time,duration,chronological_position})),
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
  return payload;
}

function audioDownloadButton(node){return node.querySelector('[data-testid*="download" i],button[aria-label*="download" i],[aria-label*="baixar" i]');}
function audioPlayControl(node){return node.querySelector('[data-testid*="audio" i],[aria-label*="reproduzir" i],[aria-label*="play" i],audio');}
async function waitForAudioMedia(node,{timeoutMs=9000}={}){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const source=audioSource(node);if(source)return source;await sleep(450);}return "";}
async function waitForDownloadState(node,{timeoutMs=9000}={}){const deadline=Date.now()+timeoutMs;let buttonRemoved=false;while(Date.now()<deadline){buttonRemoved=buttonRemoved||!audioDownloadButton(node);const source=audioSource(node);if(source)return {source,buttonRemoved};await sleep(450);}return {source:"",buttonRemoved};}
function extensionMessage(message){
  return new Promise(resolve=>{
    chrome.runtime.sendMessage(message,response=>{
      resolve(chrome.runtime.lastError?{ok:false,error:chrome.runtime.lastError.message||"A extensão não respondeu."}:response||{ok:false,error:"A extensão não respondeu."});
    });
  });
}
function visibleElement(element){const style=element&&getComputedStyle(element);return Boolean(element&&style?.display!=="none"&&style?.visibility!=="hidden"&&element.getClientRects().length);}
const CONTEXT_TRIGGER_SELECTOR='[data-testid="icon-down-context"][aria-label^="Menu de contexto para a mensagem de"]';
function messageContextMenuButton(node){return [...node.querySelectorAll(CONTEXT_TRIGGER_SELECTOR)].find(visibleElement)||null;}
function nextAnimationFrame(){return new Promise(resolve=>requestAnimationFrame(()=>resolve()));}
function hoverEvent(type,point){const init={bubbles:true,cancelable:true,composed:true,view:window,clientX:point.clientX,clientY:point.clientY,screenX:point.screenX,screenY:point.screenY};try{return new PointerEvent(type,{...init,pointerType:"mouse",isPrimary:true,pointerId:1});}catch(error){return new MouseEvent(type,init);}}
function dispatchHover(target,point){for(const type of ["pointerover","pointerenter","pointermove","mouseover","mouseenter","mousemove"])target.dispatchEvent(hoverEvent(type,point));}
async function waitForContextTrigger(node,{timeoutMs=1000}={}){const existing=messageContextMenuButton(node);if(existing)return {trigger:existing,mutationDetected:false};return new Promise(resolve=>{let settled=false;const finish=trigger=>{if(settled)return;settled=true;clearTimeout(timer);observer.disconnect();resolve({trigger,mutationDetected:Boolean(trigger)});};const observer=new MutationObserver(()=>{const trigger=messageContextMenuButton(node);if(trigger)finish(trigger);});observer.observe(node,{childList:true,subtree:true,attributes:true,attributeFilter:["style","class","aria-label","data-testid"]});const timer=setTimeout(()=>finish(messageContextMenuButton(node)),timeoutMs);});}
async function revealMessageContextMenuTrigger(node,diagnostic){
  node.scrollIntoView({block:"center",inline:"nearest"});await nextAnimationFrame();await sleep(180);const rect=node.getBoundingClientRect();diagnostic.bubble_rect={x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)};if(!rect.width||!rect.height){diagnostic.status="erro";diagnostic.reason="A bolha de áudio não possui área visível para receber hover.";return null;}
  const point={clientX:Math.round(rect.right-Math.min(24,rect.width*.12)),clientY:Math.round(rect.top+Math.min(18,rect.height*.3)),screenX:Math.round(window.screenX+rect.right-Math.min(24,rect.width*.12)),screenY:Math.round(window.screenY+rect.top+Math.min(18,rect.height*.3))};const targets=[node,node.querySelector('[data-testid="msg-container"]'),node.parentElement].filter((item,index,array)=>item&&array.indexOf(item)===index);diagnostic.hover_coordinates=point;diagnostic.hover_target=[];diagnostic.pointer_events_sent=[];diagnostic.status="hover_enviado";
  for(const target of targets){diagnostic.hover_target.push(target===node?"bolha":target===node.parentElement?"pai":"container");dispatchHover(target,point);diagnostic.pointer_events_sent.push("pointerover","pointerenter","pointermove","mouseover","mouseenter","mousemove");await nextAnimationFrame();const immediate=messageContextMenuButton(node);if(immediate){diagnostic.mutation_detected=true;diagnostic.trigger_found=true;diagnostic.trigger_visible=true;diagnostic.trigger_selector=CONTEXT_TRIGGER_SELECTOR;diagnostic.status="seta_detectada";return immediate;}}
  diagnostic.synthetic_hover_failed=true;const observedPromise=waitForContextTrigger(node);const realMove=await extensionMessage({type:"criare-dispatch-real-mouse-move",request:{clientX:point.clientX,clientY:point.clientY}});diagnostic.debugger_attached=Boolean(realMove?.debugger_attached);diagnostic.mouse_move_dispatched=Boolean(realMove?.mouse_move_dispatched);diagnostic.target_coordinates=realMove?.target_coordinates||point;diagnostic.debugger_detached=Boolean(realMove?.debugger_detached);const observed=await observedPromise;diagnostic.mutation_detected=observed.mutationDetected;diagnostic.trigger_found=Boolean(observed.trigger);diagnostic.trigger_visible=Boolean(observed.trigger&&visibleElement(observed.trigger));diagnostic.trigger_selector=observed.trigger?CONTEXT_TRIGGER_SELECTOR:"";diagnostic.status=observed.trigger?"seta_detectada":"seta_nao_detectada";if(!observed.trigger)diagnostic.reason=realMove?.error||"O WhatsApp não exibiu a seta mesmo após o movimento real do ponteiro.";return observed.trigger||null;
}
async function openMessageContextMenu(node,diagnostic){
  const trigger=await revealMessageContextMenuTrigger(node,diagnostic);if(!trigger)return null;const alreadyOpen=new Set([...document.querySelectorAll('[role="dialog"] [role="menu"]')]);const menuPromise=new Promise(resolve=>{let done=false;const finish=menu=>{if(done)return;done=true;clearTimeout(timer);observer.disconnect();resolve(menu);};const find=()=>[...document.querySelectorAll('[role="dialog"] [role="menu"]')].find(menu=>visibleElement(menu)&&!alreadyOpen.has(menu));const observer=new MutationObserver(()=>{const menu=find();if(menu)finish(menu);});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","class","role"]});const timer=setTimeout(()=>finish(find()),1000);});trigger.click();diagnostic.trigger_clicked=true;diagnostic.status="seta_clicada";const menu=await menuPromise;diagnostic.dialog_found=Boolean(menu?.closest('[role="dialog"]'));diagnostic.menu_found=Boolean(menu);diagnostic.menu_render_location=menu?.closest('[role="dialog"]')?"dialog":"";diagnostic.status=menu?"menu_aberto":"menu_nao_aberto";if(!menu)diagnostic.reason="A seta foi clicada, mas o menu contextual não apareceu.";return menu||null;
}
function downloadMenuOption(menu=null){
  const menus=menu?[menu]:[...document.querySelectorAll('[role="menu"], [data-testid*="context-menu" i]')].filter(visibleElement);
  for(const currentMenu of menus){for(const item of currentMenu.querySelectorAll('button[role="menuitem"][aria-label="Baixar"],[role="menuitem"],[aria-label]')){const label=normalizedUiText(`${item.getAttribute("aria-label")||""} ${item.textContent||""}`);if(label==="baixar"||label==="download"||label.startsWith("baixar ")||label.startsWith("download "))return item;}}
  return null;
}
async function waitForDownloadMenu({timeoutMs=2500}={}){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const option=downloadMenuOption();if(option)return option;await sleep(120);}return null;}
function closeContextMenu(){document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",bubbles:true}));}
async function downloadAudioFromContextMenu(node,{requestId,messageId,diagnostic}){
  const started=await extensionMessage({type:"criare-start-audio-download-watch",request:{request_id:requestId,message_id:messageId}});if(!started?.ok)return {ok:false,code:"download_watch_failed",error:started?.error||"Não foi possível preparar o monitoramento do download."};
  diagnostic.context_menu_found=Boolean(messageContextMenuButton(node));const menuButton=openMessageContextMenu(node);diagnostic.context_menu_opened=Boolean(menuButton);if(!menuButton){await extensionMessage({type:"criare-cancel-audio-download-watch",request:{request_id:requestId}});return {ok:false,code:"context_menu_not_found",error:"O menu contextual desta mensagem não foi localizado."};}
  const option=await waitForDownloadMenu();diagnostic.download_option_found=Boolean(option);if(!option){closeContextMenu();await extensionMessage({type:"criare-cancel-audio-download-watch",request:{request_id:requestId}});return {ok:false,code:"menu_sem_opcao_baixar",error:"O menu da mensagem não apresentou a ação Baixar."};}
  diagnostic.status="download_solicitado";diagnostic.download_clicked=true;option.click();closeContextMenu();const result=await extensionMessage({type:"criare-wait-audio-download",request:{request_id:requestId}});return result||{ok:false,code:"timeout_download",error:"O download não retornou resultado."};
}
async function recoverAudioEntries(request={}){
  const main=activeMain();if(!main)throw new Error("O painel da conversa não foi carregado para recuperar áudios.");
  const targets=Array.isArray(request.audioTargets)?request.audioTargets:[];const targetKey=(target,index)=>target.id||target.message_id||`legacy:${index}`;const targetMessageId=target=>normalizeWhatsAppMessageId(target?.message_id||target?.id);const validDuration=value=>Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<600?Number(value):null;const found=new Map();const diagnostics=new Map(targets.map((target,index)=>{const key=targetKey(target,index);return [key,{message_id:targetMessageId(target)||key,position:target.chronological_position??index,sender:target.sender||"",date:target.date||"",message_time:target.message_time||target.time||"",duration_text:target.duration_text||"",duration_seconds:validDuration(target.duration_seconds||target.duration),found_in_dom:false,play_found:false,url_found:false,status:"aguardando_dom",reason:""}];}));
  const inspect=async()=>{
    for(const [position,node] of voiceMessageNodes(main).entries()){
      const detail=node.querySelector("[data-pre-plain-text]");const prefix=cleanText(detail?.getAttribute("data-pre-plain-text"))||"";const parts=prefixParts(prefix);const detectedDirection=messageDirection(node);const domMessageId=normalizeWhatsAppMessageId(messageId(node));if(!domMessageId)continue;const exactTarget=targets.find(item=>targetMessageId(item)===domMessageId);if(!exactTarget)continue;const target=exactTarget;const direction=canonicalAudioDirection(parts.sender||target.sender,detectedDirection);
      const key=targetKey(target,targets.indexOf(target));if(found.has(key))continue;
      const diagnostic=diagnostics.get(key)||{};const durationText=audioDurationText(node);const playerDuration=playerDurationSeconds(durationText);diagnostic.found_in_dom=true;diagnostic.sender=parts.sender||diagnostic.sender;diagnostic.date=parts.date||diagnostic.date;diagnostic.message_time=parts.time||diagnostic.message_time;diagnostic.duration_text=durationText||diagnostic.duration_text;diagnostic.duration_seconds=playerDuration||diagnostic.duration_seconds;diagnostic.play_found=Boolean(audioPlayControl(node));diagnostic.download_found=Boolean(audioDownloadButton(node));diagnostic.url_found=Boolean(audioSource(node));
      const recovered={...target,id:target.id||`wa:${domMessageId}`,message_id:domMessageId,sender:parts.sender||target.sender||null,direction,date:parts.date||target.date||null,time:parts.time||target.message_time||target.time||null,message_time:parts.time||target.message_time||target.time||null,duration:playerDuration,duration_text:durationText,duration_seconds:playerDuration,duration_source:playerDuration?"whatsapp_player":"missing",duration_valid:Boolean(playerDuration),chronological_position:target.chronological_position??position,audioMeta:publicAudioMeta(audioMeta(domMessageId,{...(target.audioMeta||{}),durationSeconds:playerDuration,durationSource:playerDuration?"whatsapp_player":"missing",extractionStatus:target.audioMeta?.extractionStatus||"pending",transcriptionStatus:target.audioMeta?.transcriptionStatus||"pending"})),audioTranscribed:Boolean(target.audioTranscribed),hasVoiceMessage:true,type:"Áudio"};
      diagnostic.status=playerDuration?"metadados_atualizados":"duracao_nao_lida";diagnostic.reason=playerDuration?"Duração lida diretamente do texto interno do player.":"O player foi localizado, mas não exibiu duração interna válida.";found.set(key,recovered);
    }
  };
  const scroller=messageScrollContainer(main);let passes=0;let stable=0;let previous="";if(scroller)scroller.scrollTop=scroller.scrollHeight;
  while(scroller&&passes<220&&stable<2){await inspect();const signature=windowSignature(main);const before=scroller.scrollTop;scroller.scrollTop=Math.max(0,before-Math.max(scroller.clientHeight*.8,650));scroller.dispatchEvent(new Event("scroll",{bubbles:true}));await sleep(550);await waitForMessagesToSettle(main,{timeoutMs:3500,minWaitMs:350});stable=before<=2&&signature===previous?stable+1:0;previous=signature;passes+=1;}
  await inspect();for(const [id,diagnostic] of diagnostics){if(!found.has(id)){diagnostic.status="nao_localizado_no_dom";diagnostic.reason="Mensagem não localizada após percorrer o histórico disponível no WhatsApp Web.";}}
  if(scroller){scroller.scrollTop=scroller.scrollHeight;scroller.dispatchEvent(new Event("scroll",{bubbles:true}));}
  return {ok:true,title:activeChatTitle(),entries:[...found.values()],diagnostics:[...diagnostics.values()],availableInDom:[...diagnostics.values()].filter(item=>item.found_in_dom).length};
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
  if(message?.type === "criare-wait-for-conversation"){
    waitForConversationStable(message.request || {},{timeoutMs:Number(message.timeoutMs)||65000})
      .then(state=>sendResponse({ok:Boolean(state.ready),contentScriptVersion:CRIARE_CONTENT_SCRIPT_VERSION,...state}))
      .catch(error=>sendResponse({ok:false,contentScriptVersion:CRIARE_CONTENT_SCRIPT_VERSION,code:"spa_timeout",error:error.message||"Tempo esgotado na transição interna do WhatsApp Web."}));
    return true;
  }
  if(message?.type === "criare-open-conversation-fallback"){
    openConversationFromSidebar(message.request || {})
      .then(result=>sendResponse({contentScriptVersion:CRIARE_CONTENT_SCRIPT_VERSION,...result}))
      .catch(error=>sendResponse({ok:false,contentScriptVersion:CRIARE_CONTENT_SCRIPT_VERSION,code:"sidebar_open_failed",error:error.message||"Não foi possível abrir o contato pela lista lateral."}));
    return true;
  }
  if(message?.type === "criare-recover-audios"){
    recoverAudioEntries(message.request||{}).then(result=>sendResponse({contentScriptVersion:CRIARE_CONTENT_SCRIPT_VERSION,...result})).catch(error=>sendResponse({ok:false,contentScriptVersion:CRIARE_CONTENT_SCRIPT_VERSION,error:error.message||"Não foi possível recuperar os áudios."}));
    return true;
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
