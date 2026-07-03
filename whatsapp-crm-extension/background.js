chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type !== "criare-capture-active-whatsapp") return false;

  chrome.tabs.query({url:"https://web.whatsapp.com/*"}).then(async tabs => {
    if(!tabs.length){
      sendResponse({ok:false, error:"Abra o WhatsApp Web em outra aba e entre na conversa do cliente."});
      return;
    }
    const active = tabs.find(tab=>tab.active) || tabs.sort((a,b)=>(b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    try{
      const result = await chrome.tabs.sendMessage(active.id, {
        type:"criare-extract-active-chat",
        request:message.request || {}
      });
      sendResponse(result || {ok:false, error:"O WhatsApp Web não devolveu a conversa."});
    }catch(error){
      sendResponse({
        ok:false,
        error:"Atualize a aba do WhatsApp Web, abra a conversa desejada e tente novamente."
      });
    }
  }).catch(() => sendResponse({ok:false, error:"Não foi possível localizar o WhatsApp Web."}));

  return true;
});
