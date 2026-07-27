"use strict";

if(!globalThis.__criareWhatsAppCrmBridgeRegistered){
  globalThis.__criareWhatsAppCrmBridgeRegistered=true;

  function readRequest(datasetKey){
    try{return JSON.parse(document.documentElement.dataset[datasetKey]||"{}");}
    catch(error){return {};}
    finally{delete document.documentElement.dataset[datasetKey];}
  }
  function returnResult(datasetKey,eventName,result){
    document.documentElement.dataset[datasetKey]=JSON.stringify(result||{ok:false});
    document.dispatchEvent(new CustomEvent(eventName));
  }
  function structuredRuntimeError(error,request={}){
    const message=String(error?.message||error||"Extensão indisponível.");const invalidated=/extension context invalidated|context invalidated|receiving end does not exist/i.test(message);
    return {ok:false,requestId:request.requestId||null,code:invalidated?"extension_context_invalidated":"extension_runtime_error",error:invalidated?"A conexão desta aba com a extensão expirou. Clique em “Reconectar extensão”.":message,reconnectRequired:invalidated};
  }
  async function sendRuntimeMessage(message,request={}){
    try{
      if(!globalThis.chrome?.runtime?.id)throw new Error("Extension context invalidated.");
      const result=await chrome.runtime.sendMessage(message);
      return {...(result||{ok:false}),requestId:request.requestId||result?.requestId||null};
    }catch(error){return structuredRuntimeError(error,request);}
  }
  function bridge({eventName,requestKey,resultKey,resultEvent,type}){
    document.addEventListener(eventName,async()=>{const request=readRequest(requestKey);const result=await sendRuntimeMessage({type,request},request);returnResult(resultKey,resultEvent,result);});
  }

  bridge({eventName:"criare-whatsapp-open",requestKey:"criareWhatsAppOpenRequest",resultKey:"criareWhatsAppOpenResult",resultEvent:"criare-whatsapp-open-result",type:"criare-open-whatsapp-chat"});
  bridge({eventName:"criare-whatsapp-auto-sync",requestKey:"criareWhatsAppAutoSyncRequest",resultKey:"criareWhatsAppAutoSyncResult",resultEvent:"criare-whatsapp-auto-sync-result",type:"criare-sync-whatsapp-record"});
  bridge({eventName:"criare-whatsapp-open-capture",requestKey:"criareWhatsAppOpenCaptureRequest",resultKey:"criareWhatsAppOpenCaptureResult",resultEvent:"criare-whatsapp-open-capture-result",type:"criare-capture-open-whatsapp"});
  bridge({eventName:"criare-whatsapp-recover-audios",requestKey:"criareWhatsAppAudioRecoveryRequest",resultKey:"criareWhatsAppAudioRecoveryResult",resultEvent:"criare-whatsapp-audio-recovery-result",type:"criare-recover-whatsapp-audios"});
  bridge({eventName:"criare-whatsapp-extension-ping",requestKey:"criareWhatsAppExtensionPingRequest",resultKey:"criareWhatsAppExtensionPingResult",resultEvent:"criare-whatsapp-extension-ping-result",type:"criare-extension-status"});
  bridge({eventName:"criare-whatsapp-preflight",requestKey:"criareWhatsAppPreflightRequest",resultKey:"criareWhatsAppPreflightResult",resultEvent:"criare-whatsapp-preflight-result",type:"criare-preflight-whatsapp"});

  try{
    chrome.runtime.onMessage.addListener(message=>{
      if(message?.type!=="criare-audio-transcription-update")return false;
      document.documentElement.dataset.criareWhatsAppAudioTranscriptionUpdate=JSON.stringify({phone:message.phone||"",entry:message.entry||{}});
      document.dispatchEvent(new CustomEvent("criare-whatsapp-audio-transcription-update"));
      return false;
    });
  }catch(error){/* a ponte responderá com a ação de reconexão no próximo pedido */}
}
