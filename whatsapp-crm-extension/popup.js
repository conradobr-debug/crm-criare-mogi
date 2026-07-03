function openOrFocus(urlPattern, createUrl){
  chrome.tabs.query({url:urlPattern}).then(tabs=>{
    const tab = tabs[0];
    if(tab) chrome.tabs.update(tab.id, {active:true});
    else chrome.tabs.create({url:createUrl});
  });
}

document.getElementById("openCrm").addEventListener("click", ()=>{
  openOrFocus("https://conradobr-debug.github.io/crm-criare-mogi/*", "https://conradobr-debug.github.io/crm-criare-mogi/");
});

document.getElementById("openWhatsApp").addEventListener("click", ()=>{
  openOrFocus("https://web.whatsapp.com/*", "https://web.whatsapp.com/");
});
