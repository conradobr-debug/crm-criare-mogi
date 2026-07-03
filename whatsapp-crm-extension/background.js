chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type !== "criare-capture-active-whatsapp") return false;

  chrome.tabs.query({url:"https://web.whatsapp.com/*"}).then(async tabs => {
    if(!tabs.length){
      sendResponse({ok:false, error:"Abra o WhatsApp Web em outra aba e entre na conversa do cliente."});
      return;
    }
    const orderedTabs = tabs.sort((a,b)=>(b.lastAccessed || 0) - (a.lastAccessed || 0));
    const checkedTitles = [];
    let tabsWithoutExtension = 0;
    for(const tab of orderedTabs){
      try{
        const result = await chrome.tabs.sendMessage(tab.id, {
          type:"criare-extract-active-chat",
          request:message.request || {}
        });
        if(result?.ok){
          sendResponse(result);
          return;
        }
        if(result?.title) checkedTitles.push(result.title);
      }catch(error){
        tabsWithoutExtension += 1;
      }
    }
    const titles = [...new Set(checkedTitles)].filter(Boolean);
    const details = titles.length ? ` Conversas abertas: ${titles.join("; ")}.` : "";
    const refresh = tabsWithoutExtension ? " Atualize todas as abas do WhatsApp Web após instalar a extensão." : "";
    sendResponse({
      ok:false,
      extensionVersion:chrome.runtime.getManifest().version,
      error:`Nenhuma aba aberta corresponde ao cliente do CRM.${details}${refresh}`
    });
  }).catch(() => sendResponse({ok:false, error:"Não foi possível localizar o WhatsApp Web."}));

  return true;
});
