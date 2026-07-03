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

async function openCustomerChat(request){
  const phone = String(request?.phone || "").replace(/\D/g, "");
  if(phone.length < 12 || phone.length > 13){
    return {ok:false, error:"O telefone do cliente está incompleto."};
  }
  const url = `https://web.whatsapp.com/send/?phone=${phone}&type=phone_number&app_absent=0`;
  const tab = await chrome.tabs.create({url, active:true});
  await saveTarget(phone, tab.id);
  return {ok:true, extensionVersion:chrome.runtime.getManifest().version};
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
  return false;
});
