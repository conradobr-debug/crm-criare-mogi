document.addEventListener("criare-whatsapp-capture", () => {
  let request = {};
  try{
    request = JSON.parse(document.documentElement.dataset.criareWhatsAppRequest || "{}");
  }catch(error){
    request = {};
  }
  delete document.documentElement.dataset.criareWhatsAppRequest;

  chrome.runtime.sendMessage({type:"criare-capture-active-whatsapp", request}, result => {
    const response = chrome.runtime.lastError
      ? {ok:false, error:"A extensão Criare precisa ser recarregada no Chrome."}
      : (result || {ok:false, error:"Não foi possível capturar a conversa."});
    document.documentElement.dataset.criareWhatsAppResult = JSON.stringify(response);
    document.dispatchEvent(new CustomEvent("criare-whatsapp-result"));
  });
});

document.addEventListener("criare-whatsapp-open", () => {
  let request = {};
  try{
    request = JSON.parse(document.documentElement.dataset.criareWhatsAppOpenRequest || "{}");
  }catch(error){
    request = {};
  }
  delete document.documentElement.dataset.criareWhatsAppOpenRequest;

  chrome.runtime.sendMessage({type:"criare-open-whatsapp-chat", request}, result => {
    const response = chrome.runtime.lastError
      ? {ok:false, error:"A extensão Criare precisa ser atualizada e recarregada."}
      : (result || {ok:false, error:"Não foi possível abrir a conversa."});
    document.documentElement.dataset.criareWhatsAppOpenResult = JSON.stringify(response);
    document.dispatchEvent(new CustomEvent("criare-whatsapp-open-result"));
  });
});

document.addEventListener("criare-whatsapp-auto-sync", () => {
  let request = {};
  try{
    request = JSON.parse(document.documentElement.dataset.criareWhatsAppAutoSyncRequest || "{}");
  }catch(error){
    request = {};
  }
  delete document.documentElement.dataset.criareWhatsAppAutoSyncRequest;

  chrome.runtime.sendMessage({type:"criare-sync-whatsapp-record", request}, result => {
    const response = chrome.runtime.lastError
      ? {ok:false, requestId:request.requestId, error:"A extensão Criare precisa ser atualizada e recarregada."}
      : {...(result || {ok:false, error:"Não foi possível atualizar a conversa."}), requestId:request.requestId};
    document.documentElement.dataset.criareWhatsAppAutoSyncResult = JSON.stringify(response);
    document.dispatchEvent(new CustomEvent("criare-whatsapp-auto-sync-result"));
  });
});
