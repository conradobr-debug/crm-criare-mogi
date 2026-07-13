"use strict";

function readRequest(datasetKey){
  try{ return JSON.parse(document.documentElement.dataset[datasetKey] || "{}"); }
  catch(error){ return {}; }
  finally{ delete document.documentElement.dataset[datasetKey]; }
}

function returnResult(datasetKey,eventName,result){
  document.documentElement.dataset[datasetKey] = JSON.stringify(result || {ok:false});
  document.dispatchEvent(new CustomEvent(eventName));
}

document.addEventListener("criare-whatsapp-open",()=>{
  const request = readRequest("criareWhatsAppOpenRequest");
  chrome.runtime.sendMessage({type:"criare-open-whatsapp-chat",request},result=>{
    returnResult("criareWhatsAppOpenResult","criare-whatsapp-open-result",chrome.runtime.lastError
      ? {ok:false,error:"A extensão Criare precisa ser recarregada no Chrome."}
      : result);
  });
});

document.addEventListener("criare-whatsapp-auto-sync",()=>{
  const request = readRequest("criareWhatsAppAutoSyncRequest");
  chrome.runtime.sendMessage({type:"criare-sync-whatsapp-record",request},result=>{
    returnResult("criareWhatsAppAutoSyncResult","criare-whatsapp-auto-sync-result",chrome.runtime.lastError
      ? {ok:false,requestId:request.requestId,error:"A extensão Criare precisa ser atualizada e recarregada."}
      : {...(result || {ok:false}),requestId:request.requestId});
  });
});

document.addEventListener("criare-whatsapp-open-capture",()=>{
  const request = readRequest("criareWhatsAppOpenCaptureRequest");
  chrome.runtime.sendMessage({type:"criare-capture-open-whatsapp",request},result=>{
    returnResult("criareWhatsAppOpenCaptureResult","criare-whatsapp-open-capture-result",chrome.runtime.lastError
      ? {ok:false,requestId:request.requestId,error:"A extensão Criare precisa ser recarregada no Chrome."}
      : {...(result || {ok:false}),requestId:request.requestId});
  });
});

document.addEventListener("criare-whatsapp-extension-ping",()=>{
  const request = readRequest("criareWhatsAppExtensionPingRequest");
  chrome.runtime.sendMessage({type:"criare-extension-status"},result=>{
    returnResult("criareWhatsAppExtensionPingResult","criare-whatsapp-extension-ping-result",chrome.runtime.lastError
      ? {ok:false,requestId:request.requestId,error:"Extensão Criare indisponível neste computador."}
      : {...(result || {ok:false}),requestId:request.requestId});
  });
});
