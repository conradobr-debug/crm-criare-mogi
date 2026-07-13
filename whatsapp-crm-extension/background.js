"use strict";

const TARGETS_KEY = "criareWhatsAppTargetTabs";
const CAPTURE_TIMEOUT_MS = 210000;

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

async function openCustomerChat(request){
  const phone = validPhone(request?.phone);
  if(!phone) return {ok:false,error:"O telefone do cliente está incompleto."};
  const tab = await reusableWhatsAppTab({active:true});
  await chrome.tabs.update(tab.id,{url:`https://web.whatsapp.com/send/?phone=${phone}&type=phone_number&app_absent=0`,active:true});
  await saveTarget(phone,tab.id);
  return {ok:true,extensionVersion:chrome.runtime.getManifest().version};
}

async function syncCustomerChat(request){
  const phone = validPhone(request?.phone);
  if(!phone) return {ok:false,extensionVersion:chrome.runtime.getManifest().version,error:"O telefone do cliente está incompleto."};
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
  if(loaded.empty){
    return withProfilePhoto({
      ok:true,empty:true,noConversation:Boolean(loaded.unavailable),transcript:"",entries:[],count:0,
      audioCount:0,audioTranscribed:0,audioExtensionDetected:false,reachedStart:true,limited:false,
      extensionVersion:chrome.runtime.getManifest().version,tabUrl:(await chrome.tabs.get(tab.id).catch(()=>({}))).url||"",detectedTitle:loaded.state?.title||"",domCount:0
    },loaded.state?.profilePhotoUrl);
  }

  const extraction = chrome.tabs.sendMessage(tab.id,{
    type:"criare-extract-active-chat",
    request
  });
  const timeout = new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:"A leitura completa ultrapassou o tempo de segurança. O histórico anterior foi preservado."}),CAPTURE_TIMEOUT_MS));
  const result = await Promise.race([extraction,timeout]);
  const currentTab=await chrome.tabs.get(tab.id).catch(()=>({}));
  if(!result?.ok) return {...(result || {}),ok:false,extensionVersion:chrome.runtime.getManifest().version,tabUrl:currentTab.url||"",detectedTitle:result?.title||loaded.state?.title||"",domCount:Number(result?.count||loaded.state?.count||0),error:result?.error || "A conversa não devolveu mensagens."};
  return withProfilePhoto({...result,extensionVersion:chrome.runtime.getManifest().version,tabUrl:currentTab.url||"",detectedTitle:result.title||loaded.state?.title||"",domCount:Number(result.count||0)},result.profilePhotoUrl || loaded.state?.profilePhotoUrl);
}

async function captureCustomerChat(request){
  const phone = validPhone(request?.phone);
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

async function captureOpenWhatsAppChat(request){
  const extensionVersion = chrome.runtime.getManifest().version;
  const activeTabs = await chrome.tabs.query({url:"https://web.whatsapp.com/*",active:true,currentWindow:true});
  const allTabs = activeTabs.length ? activeTabs : await chrome.tabs.query({url:"https://web.whatsapp.com/*"});
  const tab = allTabs.sort((a,b)=>(b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if(!tab?.id) return {ok:false,extensionVersion,error:"Nenhuma aba do WhatsApp Web está aberta. Abra a conversa correta e tente novamente."};
  try{
    await ensureCurrentContentScript(tab.id);
    const extraction = chrome.tabs.sendMessage(tab.id,{type:"criare-extract-active-chat",request});
    const timeout = new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:"A leitura da conversa aberta ultrapassou o tempo de segurança."}),CAPTURE_TIMEOUT_MS));
    const result = await Promise.race([extraction,timeout]);
    const currentTab=await chrome.tabs.get(tab.id).catch(()=>tab);
    if(!result?.ok) return {...(result || {}),ok:false,extensionVersion,tabUrl:currentTab.url||tab.url||"",detectedTitle:result?.title||"",domCount:Number(result?.count||0),error:result?.error || "A conversa aberta não devolveu mensagens."};
    return withProfilePhoto({...result,extensionVersion,tabUrl:currentTab.url||tab.url||"",detectedTitle:result.title||"",domCount:Number(result.count||0)},result.profilePhotoUrl);
  }catch(error){
    return {ok:false,extensionVersion,tabUrl:tab.url||"",detectedTitle:"",domCount:0,error:error.message || "Não foi possível capturar a conversa aberta."};
  }
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
    "criare-sync-whatsapp-record":syncCustomerChat
  };
  const handler = handlers[message?.type];
  if(!handler) return false;
  handler(message.request || {}).then(sendResponse).catch(error=>sendResponse({
    ok:false,extensionVersion:chrome.runtime.getManifest().version,error:error.message || "Não foi possível acessar a conversa."
  }));
  return true;
});
