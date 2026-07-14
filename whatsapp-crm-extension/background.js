"use strict";

const TARGETS_KEY = "criareWhatsAppTargetTabs";
const CAPTURE_TIMEOUT_MS = 210000;
const crmCaptureTabs = new Map();

function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

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
  const digits = String(value || "").replace(/\D/g,"");
  return digits.length >= 12 && digits.length <= 13 ? digits : "";
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

async function waitForTabComplete(tabId,{timeoutMs=45000}={}){
  const deadline = Date.now() + timeoutMs;
  while(Date.now() < deadline){
    const tab = await chrome.tabs.get(tabId);
    if(tab.status === "complete") return tab;
    await sleep(350);
  }
  throw new Error("O WhatsApp Web demorou demais para abrir a conversa correta.");
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
  const phone = validPhone(request?.phone);
  if(!phone) return {ok:false,error:"O telefone do cliente está incompleto."};
  const tab = await reusableWhatsAppTab({active:true});
  await chrome.tabs.update(tab.id,{url:`https://web.whatsapp.com/send/?phone=${phone}&type=phone_number&app_absent=0`,active:true});
  await saveTarget(phone,tab.id);
  return {ok:true,extensionVersion:chrome.runtime.getManifest().version};
}

async function syncCustomerChat(request,sender){
  const phone = validPhone(request?.phone);
  if(!phone) return {ok:false,extensionVersion:chrome.runtime.getManifest().version,error:"O telefone do cliente está incompleto."};
  if(sender?.tab?.id) crmCaptureTabs.set(phone,sender.tab.id);
  const tab = await reusableWhatsAppTab({active:false});
  try{ await chrome.tabs.sendMessage(tab.id,{type:"criare-prepare-next-chat"}); }catch(error){}
  await chrome.tabs.update(tab.id,{url:`https://web.whatsapp.com/send/?phone=${phone}&type=phone_number&app_absent=0`,active:false});
  await saveTarget(phone,tab.id);
  await waitForTabComplete(tab.id);
  await ensureCurrentContentScript(tab.id);
  const loaded = await waitForChat(tab.id,request);
  if(!loaded.ready){
    const currentTab=await chrome.tabs.get(tab.id).catch(()=>({}));
    return {ok:false,extensionVersion:chrome.runtime.getManifest().version,tabUrl:currentTab.url||"",detectedTitle:loaded.state?.title||"",domCount:Number(loaded.state?.count||0),error:loaded.mismatch
      ? `A conversa aberta é “${loaded.state?.title || "não identificada"}”, mas o lead solicitado é “${request.customerName || "não identificado"}”. Abra o cliente correto no WhatsApp Web.`
      : "O WhatsApp não confirmou que a conversa correta terminou de carregar."};
  }
  return captureChatFromTab(tab.id,request,loaded.state);
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

async function preflightWhatsApp(request,sender){
  const extensionVersion = chrome.runtime.getManifest().version;
  const tabs = await chrome.tabs.query({url:"https://web.whatsapp.com/*"});
  const tab = tabs.sort((a,b)=>(b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if(!tab?.id) return {ok:false,extensionVersion,whatsappTabFound:false,contentScriptReady:false,whatsappLoggedIn:false,error:"Nenhuma aba do WhatsApp Web está aberta."};
  try{
    const status = await chrome.tabs.sendMessage(tab.id,{type:"criare-content-script-status"});
    if(status?.contentScriptVersion !== extensionVersion) throw new Error("O leitor do WhatsApp Web está desatualizado.");
    const readiness = await chrome.tabs.sendMessage(tab.id,{type:"criare-whatsapp-readiness"});
    return {ok:Boolean(readiness?.ok&&readiness.loggedIn),extensionVersion,whatsappTabFound:true,contentScriptReady:Boolean(readiness?.ok),whatsappLoggedIn:Boolean(readiness?.loggedIn),tabUrl:tab.url||"",messageNodes:Number(readiness?.messageNodes||0),detectedTitle:readiness?.title||"",error:readiness?.loggedIn?"":"O WhatsApp Web não está conectado."};
  }catch(error){
    return {ok:false,extensionVersion,whatsappTabFound:true,contentScriptReady:false,whatsappLoggedIn:false,tabUrl:tab.url||"",error:error.message||"O content script do WhatsApp Web não respondeu."};
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
