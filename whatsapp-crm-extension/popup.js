"use strict";

async function openOrFocus(pattern,url){
  const tabs = await chrome.tabs.query({url:pattern});
  if(tabs[0]) await chrome.tabs.update(tabs[0].id,{active:true});
  else await chrome.tabs.create({url,active:true});
}

document.getElementById("openCrm").addEventListener("click",()=>openOrFocus(
  "https://conradobr-debug.github.io/crm-criare-mogi/*",
  "https://conradobr-debug.github.io/crm-criare-mogi/"
));
document.getElementById("openWhatsApp").addEventListener("click",()=>openOrFocus(
  "https://web.whatsapp.com/*",
  "https://web.whatsapp.com/"
));
