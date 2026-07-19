"use strict";

importScripts("phone-identity.js");

const TARGETS_KEY = "criareWhatsAppTargetTabs";
const CAPTURE_TIMEOUT_MS = 210000;
const crmCaptureTabs = new Map();
let activeConversationOperation = null;
const activeAudioDownloads = new Map();

function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

function downloadFromWhatsApp(item){
  return /(?:^|\.)whatsapp(?:\.net|\.com)(?:\/|$)/i.test(`${item?.url||""} ${item?.finalUrl||""} ${item?.referrer||""}`);
}

function publicDownload(item={}){
  const size=Number(item.fileSize||item.totalBytes||0);
  return {download_id:Number(item.id||0)||null,download_state:String(item.state||""),filename:String(item.filename||""),mime_type:String(item.mime||""),size,source_url:String(item.finalUrl||item.url||"")};
}

async function startAudioDownloadWatch(request,sender){
  const requestId=String(request?.request_id||"").trim();const messageId=String(request?.message_id||"").trim();const tabId=Number(sender?.tab?.id||0);
  if(!requestId||!messageId||!tabId)return {ok:false,error:"Identificação insuficiente para monitorar o download do áudio."};
  if(activeAudioDownloads.has(requestId))return {ok:false,error:"Já existe um monitoramento de download para este áudio."};
  const startedAt=Date.now();const existing=new Set((await chrome.downloads.search({})).map(item=>item.id));
  let resolveWatch;const watch=new Promise(resolve=>{resolveWatch=resolve;});let downloadId=null;let finished=false;
  const finish=async(result)=>{if(finished)return;finished=true;clearTimeout(timer);chrome.downloads.onCreated.removeListener(onCreated);chrome.downloads.onChanged.removeListener(onChanged);activeAudioDownloads.delete(requestId);resolveWatch(result);};
  const matches=item=>Boolean(item&&!existing.has(item.id)&&new Date(item.startTime||0).getTime()>=startedAt-1500&&downloadFromWhatsApp(item));
  const onCreated=item=>{if(!matches(item)||downloadId)return;downloadId=item.id;if(item.state==="complete")finish({ok:Number(item.fileSize||item.totalBytes||0)>0,...publicDownload(item),request_id:requestId,message_id:messageId,tab_id:tabId});};
  const onChanged=async delta=>{if(!downloadId||delta.id!==downloadId||!delta.state)return;if(delta.state.current!=="complete"&&delta.state.current!=="interrupted")return;const [item]=await chrome.downloads.search({id:downloadId});if(delta.state.current==="complete"&&Number(item?.fileSize||item?.totalBytes||0)>0)finish({ok:true,...publicDownload(item),request_id:requestId,message_id:messageId,tab_id:tabId});else finish({ok:false,code:delta.state.current==="interrupted"?"download_interrupted":"download_empty",error:delta.state.current==="interrupted"?"O download do áudio foi interrompido.":"O download retornou um arquivo vazio.",...publicDownload(item||{}),request_id:requestId,message_id:messageId,tab_id:tabId});};
  const timer=setTimeout(()=>finish({ok:false,code:"timeout_download",error:"O download do áudio não foi identificado dentro do tempo de segurança.",request_id:requestId,message_id:messageId,tab_id:tabId}),30000);
  chrome.downloads.onCreated.addListener(onCreated);chrome.downloads.onChanged.addListener(onChanged);
  activeAudioDownloads.set(requestId,{watch,finish,messageId,tabId,startedAt});
  return {ok:true,request_id:requestId,message_id:messageId,started_at:new Date(startedAt).toISOString(),tab_id:tabId};
}

async function waitForAudioDownload(request){
  const requestId=String(request?.request_id||"").trim();const operation=activeAudioDownloads.get(requestId);
  if(!operation)return {ok:false,error:"O monitoramento temporário deste download não está ativo."};
  return operation.watch;
}

async function cancelAudioDownloadWatch(request){
  const operation=activeAudioDownloads.get(String(request?.request_id||"").trim());if(operation)await operation.finish({ok:false,code:"download_cancelled",error:"O download do áudio foi cancelado antes da conclusão."});
  return {ok:true};
}

async function dispatchRealMouseMove(request,sender){
  const tabId=Number(sender?.tab?.id||0);const url=String(sender?.tab?.url||"");const x=Number(request?.clientX);const y=Number(request?.clientY);const result={ok:false,debugger_attached:false,mouse_move_dispatched:false,debugger_detached:false,target_coordinates:{x,y},error:""};
  if(!tabId||!url.startsWith("https://web.whatsapp.com/")){result.error="O movimento real só pode ser enviado pela aba do WhatsApp Web.";return result;}
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0){result.error="Coordenadas inválidas para o movimento do ponteiro.";return result;}
  const target={tabId};
  try{
    await chrome.debugger.attach(target,"1.3");result.debugger_attached=true;
    await chrome.debugger.sendCommand(target,"Input.dispatchMouseEvent",{type:"mouseMoved",x,y,button:"none",buttons:0,pointerType:"mouse"});result.mouse_move_dispatched=true;
    await sleep(180);result.ok=true;
  }catch(error){result.error=error?.message||"Não foi possível mover o ponteiro real na aba do WhatsApp Web.";}
  finally{
    if(result.debugger_attached){try{await chrome.debugger.detach(target);result.debugger_detached=true;}catch(error){result.error=result.error||error?.message||"O debugger não pôde ser desconectado automaticamente.";}}
  }
  return result;
}

async function targetTabs(){
  const stored = await chrome.storage.session.get(TARGETS_KEY);
  return stored[TARGETS_KEY] || {};
}

async function saveTarget(phone,tabId){
  const targets = await targetTabs();
  targets[phone] = {tabId,openedAt:Date.now()};
  await chrome.storage.session.set({[TARGETS_KEY]:targets});
}

function validPhone(value){
  return globalThis.CriarePhoneIdentity.comparableDigits(value);
}

async function ensureCurrentContentScript(tabId){
  const expectedVersion = chrome.runtime.getManifest().version;
  let reloaded = false;
  for(let attempt=0;attempt<35;attempt+=1){
    try{
      const status = await chrome.tabs.sendMessage(tabId,{type:"criare-content-script-status"});
      if(status?.contentScriptVersion === expectedVersion) return {ok:true,reloaded};
    }catch(error){ /* a aba ainda pode estar carregando */ }
    if(attempt === 4 && !reloaded){ await chrome.tabs.reload(tabId); reloaded = true; }
    await sleep(800);
  }
  throw new Error("O WhatsApp Web não carregou o leitor atualizado. Recarregue a aba e tente novamente.");
}

async function reusableWhatsAppTab({active=false}={}){
  const tabs = await chrome.tabs.query({url:"https://web.whatsapp.com/*"});
  const reusable = tabs.sort((a,b)=>(b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if(reusable) return reusable;
  return chrome.tabs.create({url:"https://web.whatsapp.com/",active});
}

async function existingWhatsAppTab(){
  const tabs=await chrome.tabs.query({url:"https://web.whatsapp.com/*"});
  return tabs.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0]||null;
}

async function waitForTabComplete(tabId,{timeoutMs=45000}={}){
  const deadline = Date.now() + timeoutMs;
  while(Date.now() < deadline){
    const tab = await chrome.tabs.get(tabId);
    if(tab.status === "complete") return tab;
    await sleep(350);
  }
  throw new Error("O WhatsApp Web demorou demais para abrir a conversa correta.");
}

async function ensureConversationOpened(request,{active=false,operationId=null}={}){
  const phone = validPhone(request?.phone);
  if(!phone) return {ok:false,code:"invalid_phone",error:"Telefone inválido ou incompleto."};
  const requestId = operationId || request?.request_id || crypto.randomUUID();
  const ownsOperation = !operationId;
  if(activeConversationOperation && activeConversationOperation !== requestId) return {ok:false,code:"operation_in_progress",error:"Já existe uma navegação de conversa em andamento."};
  if(ownsOperation) activeConversationOperation = requestId;
  try{
    const tab = await reusableWhatsAppTab({active});
    if(!tab?.id) return {ok:false,code:"tab_not_found",error:"Aba do WhatsApp Web não encontrada."};
    await chrome.tabs.update(tab.id,{url:`https://web.whatsapp.com/send/?phone=${phone}&type=phone_number&app_absent=0`,active});
    await saveTarget(phone,tab.id);
    await waitForTabComplete(tab.id);
    await ensureCurrentContentScript(tab.id);
    const conversationRequest = {...request,phone,request_id:requestId,phoneNavigationConfirmed:true};
    // A primeira abertura da sessão pode não criar #main só com a rota /send.
    // Primeiro observamos a transição SPA; se ela não montar o painel, usamos a
    // busca/lista lateral e somente então aguardamos a conversa estabilizar.
    let ready = await chrome.tabs.sendMessage(tab.id,{type:"criare-wait-for-conversation",request:conversationRequest,timeoutMs:14000});
    const needsSidebarFallback = ["panel_not_created","header_not_found","messages_not_loaded","spa_timeout"].includes(ready?.code);
    if(!ready?.ok && needsSidebarFallback){
      const fallback = await chrome.tabs.sendMessage(tab.id,{type:"criare-open-conversation-fallback",request:conversationRequest});
      if(!fallback?.ok){
        const currentTab = await chrome.tabs.get(tab.id).catch(()=>({}));
        return {ok:false,code:fallback?.code||"sidebar_open_failed",error:fallback?.error||"Não foi possível abrir o primeiro contato pela lista lateral.",tabId:tab.id,tabUrl:currentTab.url||"",detectedTitle:"",domCount:0};
      }
      ready = await chrome.tabs.sendMessage(tab.id,{type:"criare-wait-for-conversation",request:conversationRequest,timeoutMs:51000});
    }
    const currentTab = await chrome.tabs.get(tab.id).catch(()=>({}));
    if(!ready?.ok) return {ok:false,code:ready?.code||"spa_timeout",error:ready?.error||"Tempo esgotado na transição interna do WhatsApp Web.",tabId:tab.id,tabUrl:currentTab.url||"",detectedTitle:ready?.title||"",domCount:Number(ready?.count||0)};
    return {ok:true,tabId:tab.id,tabUrl:currentTab.url||"",requestId,loadedState:ready,extensionVersion:chrome.runtime.getManifest().version};
  }catch(error){
    return {ok:false,code:"spa_navigation_failed",error:error.message||"Não foi possível abrir a conversa correta no WhatsApp Web."};
  }finally{
    if(ownsOperation && activeConversationOperation === requestId) activeConversationOperation = null;
  }
}

async function waitForChat(tabId,request,{timeoutMs=65000}={}){
  const deadline = Date.now() + timeoutMs;
  let unavailableChecks = 0;
  let emptyChecks = 0;
  let stableChecks = 0;
  let previousCount = -1;
  let lastState = null;
  let mismatchState = null;
  let mismatchChecks = 0;
  await sleep(1600);
  while(Date.now() < deadline){
    try{
      const state = await chrome.tabs.sendMessage(tabId,{type:"criare-chat-load-state",request});
      lastState = state;
      unavailableChecks = state?.unavailable ? unavailableChecks + 1 : 0;
      if(unavailableChecks >= 3) return {ready:true,empty:true,unavailable:true,state};
      if(state?.title && state.matches === false){
        mismatchState = state;
        mismatchChecks += 1;
        if(mismatchChecks >= 3) return {ready:false,empty:false,mismatch:true,state};
        stableChecks = 0;
        previousCount = -1;
        await sleep(900);
        continue;
      }
      mismatchChecks = 0;
      if(state?.matches && state?.ready){
        const count = Number(state.count || 0);
        stableChecks = count === previousCount ? stableChecks + 1 : 0;
        previousCount = count;
        if(stableChecks >= 3) return {ready:true,empty:false,state};
      }else{
        stableChecks = 0;
        previousCount = -1;
      }
      if(state?.matches && state?.empty){
        emptyChecks += 1;
        if(emptyChecks >= 8) return {ready:true,empty:true,state};
      }else emptyChecks = 0;
    }catch(error){
      stableChecks = 0;
      emptyChecks = 0;
    }
    await sleep(900);
  }
  return {ready:false,empty:false,mismatch:Boolean(mismatchState),state:mismatchState||lastState};
}

function bytesToBase64(bytes){
  let binary = "";
  for(let offset=0;offset<bytes.length;offset+=0x8000){
    binary += String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  }
  return btoa(binary);
}

async function profilePhotoDataUrl(source){
  if(!source) return "";
  if(source.startsWith("data:image/")) return source.length <= 1500000 ? source : "";
  if(!source.startsWith("https://")) return "";
  try{
    const response = await fetch(source,{credentials:"omit",cache:"no-store"});
    if(!response.ok) return "";
    const blob = await response.blob();
    if(!blob.type.startsWith("image/") || blob.size > 1500000) return "";
    return `data:${blob.type};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
  }catch(error){ return ""; }
}

async function withProfilePhoto(result,source){
  const clean = {...result};
  delete clean.profilePhotoUrl;
  const dataUrl = await profilePhotoDataUrl(source || result?.profilePhotoUrl || "");
  if(dataUrl) clean.profilePhotoDataUrl = dataUrl;
  return clean;
}

async function captureChatFromTab(tabId,request,loadedState=null){
  const extensionVersion = chrome.runtime.getManifest().version;
  if(loadedState?.empty){
    return withProfilePhoto({
      ok:true,empty:true,noConversation:Boolean(loadedState.unavailable),transcript:"",entries:[],count:0,
      audioCount:0,audioTranscribed:0,audioExtensionDetected:false,reachedStart:true,limited:false,
      extensionVersion,tabUrl:(await chrome.tabs.get(tabId).catch(()=>({}))).url||"",detectedTitle:loadedState.title||"",domCount:0
    },loadedState.profilePhotoUrl);
  }
  const extraction = chrome.tabs.sendMessage(tabId,{type:"criare-extract-active-chat",request});
  const timeout = new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:"A leitura completa ultrapassou o tempo de segurança. O histórico anterior foi preservado."}),CAPTURE_TIMEOUT_MS));
  const result = await Promise.race([extraction,timeout]);
  const currentTab=await chrome.tabs.get(tabId).catch(()=>({}));
  if(!result?.ok) return {...(result || {}),ok:false,extensionVersion,tabUrl:currentTab.url||"",detectedTitle:result?.title||loadedState?.title||"",domCount:Number(result?.count||loadedState?.count||0),error:result?.error || "A conversa não devolveu mensagens."};
  return withProfilePhoto({...result,extensionVersion,tabUrl:currentTab.url||"",detectedTitle:result.title||loadedState?.title||"",domCount:Number(result.count||0)},result.profilePhotoUrl || loadedState?.profilePhotoUrl);
}

async function openCustomerChat(request){
  return ensureConversationOpened(request,{active:true});
}

async function syncCustomerChat(request,sender){
  const phone = validPhone(request?.phone);
  if(!phone) return {ok:false,extensionVersion:chrome.runtime.getManifest().version,error:"O telefone do cliente está incompleto."};
  if(activeConversationOperation) return {ok:false,extensionVersion:chrome.runtime.getManifest().version,code:"operation_in_progress",error:"Já existe uma navegação ou captura em andamento."};
  const operationId = request?.request_id || crypto.randomUUID();
  activeConversationOperation = operationId;
  if(sender?.tab?.id) crmCaptureTabs.set(phone,sender.tab.id);
  try{
    const opened = await ensureConversationOpened({...request,phone,request_id:operationId},{active:false,operationId});
    if(!opened.ok) return {...opened,extensionVersion:chrome.runtime.getManifest().version};
    return await captureChatFromTab(opened.tabId,{...request,phone,request_id:operationId,phoneNavigationConfirmed:true},opened.loadedState);
  }finally{
    if(activeConversationOperation === operationId) activeConversationOperation = null;
  }
}

async function captureCustomerChat(request,sender){
  const phone = validPhone(request?.phone);
  if(sender?.tab?.id) crmCaptureTabs.set(phone,sender.tab.id);
  const targets = await targetTabs();
  const target = targets[phone];
  if(!target?.tabId) return {ok:false,error:"Abra primeiro a conversa deste cliente pelo CRM."};
  try{
    await chrome.tabs.get(target.tabId);
    return await chrome.tabs.sendMessage(target.tabId,{type:"criare-extract-active-chat",request});
  }catch(error){
    delete targets[phone];
    await chrome.storage.session.set({[TARGETS_KEY]:targets});
    return {ok:false,error:"A aba vinculada a este cliente foi fechada. Abra a conversa novamente."};
  }
}

async function captureOpenWhatsAppChat(request,sender){
  const extensionVersion = chrome.runtime.getManifest().version;
  const phone = validPhone(request?.phone);if(sender?.tab?.id&&phone)crmCaptureTabs.set(phone,sender.tab.id);
  const activeTabs = await chrome.tabs.query({url:"https://web.whatsapp.com/*",active:true,currentWindow:true});
  const allTabs = activeTabs.length ? activeTabs : await chrome.tabs.query({url:"https://web.whatsapp.com/*"});
  const tab = allTabs.sort((a,b)=>(b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if(!tab?.id) return {ok:false,extensionVersion,error:"Nenhuma aba do WhatsApp Web está aberta. Abra a conversa correta e tente novamente."};
  try{
    await ensureCurrentContentScript(tab.id);
    return captureChatFromTab(tab.id,request);
  }catch(error){
    return {ok:false,extensionVersion,tabUrl:tab.url||"",detectedTitle:"",domCount:0,error:error.message || "Não foi possível capturar a conversa aberta."};
  }
}

async function recoverCustomerAudios(request,sender){
  const phone=validPhone(request?.phone);const extensionVersion=chrome.runtime.getManifest().version;
  if(!phone)return {ok:false,extensionVersion,code:"invalid_phone",error:"Telefone inválido ou incompleto."};
  if(activeConversationOperation)return {ok:false,extensionVersion,code:"operation_in_progress",error:"Já existe uma navegação ou captura em andamento."};
  const operationId=request?.request_id||crypto.randomUUID();activeConversationOperation=operationId;
  if(sender?.tab?.id)crmCaptureTabs.set(phone,sender.tab.id);
  try{
    const existing=await existingWhatsAppTab();
    if(!existing?.id)return {ok:false,extensionVersion,code:"tab_not_found",error:"Abra o WhatsApp Web para recuperar os áudios."};
    const opened=await ensureConversationOpened({...request,phone,request_id:operationId},{active:true,operationId});
    if(!opened.ok)return {...opened,extensionVersion};
    const result=await chrome.tabs.sendMessage(opened.tabId,{type:"criare-recover-audios",request:{...request,phone,request_id:operationId}});
    return {...result,extensionVersion,reusedTabId:existing.id,tabUrl:opened.tabUrl||"",detectedTitle:result?.title||opened.loadedState?.title||""};
  }catch(error){return {ok:false,extensionVersion,error:error.message||"Não foi possível recuperar os áudios da conversa correta."};}
  finally{if(activeConversationOperation===operationId)activeConversationOperation=null;}
}

async function preflightWhatsApp(request,sender){
  const extensionVersion = chrome.runtime.getManifest().version;
  const tabs = await chrome.tabs.query({url:"https://web.whatsapp.com/*"});
  const tab = tabs.sort((a,b)=>(b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if(!tab?.id) return {ok:false,extensionVersion,whatsappTabFound:false,contentScriptReady:false,whatsappLoggedIn:false,whatsappState:"tab_not_found",error:"Nenhuma aba do WhatsApp Web está aberta."};
  try{
    const status = await chrome.tabs.sendMessage(tab.id,{type:"criare-content-script-status"});
    if(status?.contentScriptVersion !== extensionVersion) throw new Error("O leitor do WhatsApp Web está desatualizado.");
    const readiness = await chrome.tabs.sendMessage(tab.id,{type:"criare-whatsapp-readiness"});
    return {ok:Boolean(readiness?.ok&&readiness.connected),extensionVersion,whatsappTabFound:true,contentScriptReady:true,whatsappLoggedIn:Boolean(readiness?.connected),whatsappState:readiness?.state||"interface_unrecognized",tabUrl:readiness?.url||tab.url||"",readyState:readiness?.readyState||"",messageNodes:Number(readiness?.messageNodes||0),detectedTitle:readiness?.title||"",signals:readiness?.counts||{},qrCodeDetected:Boolean(readiness?.qrCodeDetected),conversationListDetected:Boolean(readiness?.conversationListDetected),panelDetected:Boolean(readiness?.panelDetected),composerDetected:Boolean(readiness?.composerDetected),message:readiness?.message||"",error:readiness?.connected?"":(readiness?.message||"O WhatsApp Web não está conectado.")};
  }catch(error){
    return {ok:false,extensionVersion,whatsappTabFound:true,contentScriptReady:false,whatsappLoggedIn:false,whatsappState:"content_script_no_response",tabUrl:tab.url||"",error:error.message||"O content script do WhatsApp Web não respondeu."};
  }
}

async function forwardAudioTranscription(message){
  const phone=validPhone(message?.request?.phone);const crmTabId=crmCaptureTabs.get(phone);
  if(!crmTabId)return {ok:false,error:"Nenhuma aba do CRM está associada a este lead."};
  try{await chrome.tabs.sendMessage(crmTabId,{type:"criare-audio-transcription-update",phone,entry:message.entry||{}});return {ok:true};}
  catch(error){crmCaptureTabs.delete(phone);return {ok:false,error:"A aba do CRM foi fechada antes da transcrição terminar."};}
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type === "criare-extension-status"){
    sendResponse({ok:true,extensionVersion:chrome.runtime.getManifest().version});
    return false;
  }
  const handlers = {
    "criare-open-whatsapp-chat":openCustomerChat,
    "criare-capture-active-whatsapp":captureCustomerChat,
    "criare-capture-open-whatsapp":captureOpenWhatsAppChat,
    "criare-recover-whatsapp-audios":recoverCustomerAudios,
    "criare-preflight-whatsapp":preflightWhatsApp,
    "criare-audio-transcription-complete":forwardAudioTranscription,
    "criare-sync-whatsapp-record":syncCustomerChat
  };
  const handler = handlers[message?.type];
  if(!handler) return false;
  const payload = message?.type === "criare-audio-transcription-complete" ? message : (message.request || {});
  handler(payload,sender).then(sendResponse).catch(error=>sendResponse({
    ok:false,extensionVersion:chrome.runtime.getManifest().version,error:error.message || "Não foi possível acessar a conversa."
  }));
  return true;
});
