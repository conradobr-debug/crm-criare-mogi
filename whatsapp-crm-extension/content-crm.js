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
