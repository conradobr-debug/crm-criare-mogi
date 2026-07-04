const TARGETS_KEY = "criareWhatsAppTargetTabs";

async function targetTabs(){
  const stored = await chrome.storage.session.get(TARGETS_KEY);
  return stored[TARGETS_KEY] || {};
}

async function saveTarget(phone, tabId){
  const targets = await targetTabs();
  targets[phone] = {tabId, openedAt:Date.now()};
  await chrome.storage.session.set({[TARGETS_KEY]:targets});
}

function sleep(ms){
  return new Promise(resolve=>setTimeout(resolve, ms));
}

async function waitForChat(tabId, request, {previousTitle="", allowSameTitle=false, timeoutMs=30000}={}){
  const deadline = Date.now() + timeoutMs;
  let emptyChecks = 0;
  let unavailableChecks = 0;
  await sleep(1500);
  while(Date.now() < deadline){
    try{
      const state = await chrome.tabs.sendMessage(tabId, {type:"criare-chat-load-state", request});
      if(state?.unavailable){
        unavailableChecks += 1;
        if(unavailableChecks >= 3) return {ready:true, empty:true, unavailable:true, state};
      }else{
        unavailableChecks = 0;
      }
      const correctConversation = Boolean(state?.matches || allowSameTitle || (state?.title && state.title !== previousTitle));
      if(correctConversation && state?.ready) return {ready:true, empty:false, state};
      if(correctConversation && state?.empty){
        emptyChecks += 1;
        if(emptyChecks >= 10) return {ready:true, empty:true, state};
      }else{
        emptyChecks = 0;
      }
    }catch(error){
      emptyChecks = 0;
    }
    await sleep(1000);
  }
  return {ready:false, empty:false, state:null};
}

function bytesToBase64(bytes){
  let binary = "";
  const chunkSize = 0x8000;
  for(let offset=0; offset<bytes.length; offset+=chunkSize){
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function profilePhotoDataUrl(source){
  if(!source) return "";
  if(source.startsWith("data:image/")) return source.length <= 1500000 ? source : "";
  if(!source.startsWith("https://")) return "";
  try{
    const response = await fetch(source, {credentials:"omit", cache:"no-store"});
    if(!response.ok) return "";
    const blob = await response.blob();
    if(!blob.type.startsWith("image/") || blob.size > 1500000) return "";
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return `data:${blob.type};base64,${bytesToBase64(bytes)}`;
  }catch(error){
    return "";
  }
}

async function withProfilePhoto(result, source){
  const dataUrl = await profilePhotoDataUrl(source || result?.profilePhotoUrl || "");
  const cleanResult = {...result};
  delete cleanResult.profilePhotoUrl;
  if(dataUrl) cleanResult.profilePhotoDataUrl = dataUrl;
  return cleanResult;
}

async function reusableWhatsAppTab({active=true}={}){
  const openTabs = await chrome.tabs.query({url:"https://web.whatsapp.com/*"});
  const reusable = openTabs.sort((a,b)=>(b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if(reusable) return reusable;
  return chrome.tabs.create({url:"https://web.whatsapp.com/", active});
}

async function openCustomerChat(request){
  const phone = String(request?.phone || "").replace(/\D/g, "");
  if(phone.length < 12 || phone.length > 13){
    return {ok:false, error:"O telefone do cliente está incompleto."};
  }
  const url = `https://web.whatsapp.com/send/?phone=${phone}&type=phone_number&app_absent=0`;
  const reusable = await reusableWhatsAppTab({active:true});
  const tab = await chrome.tabs.update(reusable.id, {url, active:true});
  await saveTarget(phone, tab.id);
  return {ok:true, extensionVersion:chrome.runtime.getManifest().version};
}

async function syncCustomerChat(request){
  const phone = String(request?.phone || "").replace(/\D/g, "");
  if(phone.length < 12 || phone.length > 13){
    return {ok:false, extensionVersion:chrome.runtime.getManifest().version, error:"O telefone do cliente está incompleto."};
  }
  const url = `https://web.whatsapp.com/send/?phone=${phone}&type=phone_number&app_absent=0`;
  const reusable = await reusableWhatsAppTab({active:false});
  try{
    await chrome.tabs.sendMessage(reusable.id, {type:"criare-prepare-next-chat"});
    await sleep(300);
  }catch(error){
    // A aba pode ainda estar carregando; a navegação abaixo continua normalmente.
  }
  let previousState = null;
  try{
    previousState = await chrome.tabs.sendMessage(reusable.id, {type:"criare-chat-load-state", request});
  }catch(error){
    previousState = null;
  }
  const allowSameTitle = String(reusable.url || "").includes(phone);
  const tab = await chrome.tabs.update(reusable.id, {url, active:false});
  await saveTarget(phone, tab.id);
  const loaded = await waitForChat(tab.id, request, {
    previousTitle:previousState?.title || "",
    allowSameTitle
  });
  if(!loaded.ready){
    return {
      ok:false,
      extensionVersion:chrome.runtime.getManifest().version,
      error:"O WhatsApp não conseguiu carregar esta conversa dentro do tempo esperado."
    };
  }
  if(loaded.empty){
    if(loaded.unavailable){
      try{ await chrome.tabs.sendMessage(tab.id, {type:"criare-prepare-next-chat"}); }catch(error){}
    }
    return withProfilePhoto({
      ok:true,
      empty:true,
      noConversation:Boolean(loaded.unavailable),
      transcript:"",
      count:0,
      title:loaded.state?.title || "",
      audioCount:0,
      audioTranscribed:0,
      audioExtensionDetected:false,
      extensionVersion:chrome.runtime.getManifest().version
    }, loaded.state?.profilePhotoUrl);
  }
  const result = await chrome.tabs.sendMessage(tab.id, {
    type:"criare-extract-active-chat",
    request:{...request, trustedTarget:true}
  });
  if(!result) return {ok:false, extensionVersion:chrome.runtime.getManifest().version, error:"A conversa não devolveu mensagens."};
  return withProfilePhoto(result, result.profilePhotoUrl || loaded.state?.profilePhotoUrl);
}

async function captureCustomerChat(request){
  const phone = String(request?.phone || "").replace(/\D/g, "");
  const targets = await targetTabs();
  const target = targets[phone];
  if(!target?.tabId){
    return {
      ok:false,
      extensionVersion:chrome.runtime.getManifest().version,
      error:"Clique primeiro em Abrir conversa dentro deste cliente. A captura não usará outra aba do WhatsApp."
    };
  }
  try{
    await chrome.tabs.get(target.tabId);
    const result = await chrome.tabs.sendMessage(target.tabId, {
      type:"criare-extract-active-chat",
      request:{...request, trustedTarget:true}
    });
    return result || {ok:false, error:"A aba correta não devolveu a conversa."};
  }catch(error){
    delete targets[phone];
    await chrome.storage.session.set({[TARGETS_KEY]:targets});
    return {
      ok:false,
      extensionVersion:chrome.runtime.getManifest().version,
      error:"A aba aberta por este cliente foi fechada ou ainda não carregou. Clique em Abrir conversa novamente, aguarde e só então capture."
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type === "criare-extension-status"){
    sendResponse({ok:true, extensionVersion:chrome.runtime.getManifest().version});
    return false;
  }
  if(message?.type === "criare-open-whatsapp-chat"){
    openCustomerChat(message.request).then(sendResponse).catch(()=>sendResponse({
      ok:false,
      error:"Não foi possível abrir a conversa do cliente."
    }));
    return true;
  }
  if(message?.type === "criare-capture-active-whatsapp"){
    captureCustomerChat(message.request).then(sendResponse).catch(()=>sendResponse({
      ok:false,
      error:"Não foi possível capturar a conversa do cliente."
    }));
    return true;
  }
  if(message?.type === "criare-sync-whatsapp-record"){
    syncCustomerChat(message.request).then(sendResponse).catch(()=>sendResponse({
      ok:false,
      extensionVersion:chrome.runtime.getManifest().version,
      error:"Não foi possível atualizar automaticamente a conversa."
    }));
    return true;
  }
  return false;
});
