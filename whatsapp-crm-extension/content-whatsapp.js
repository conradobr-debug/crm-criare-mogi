function cleanText(value){
  return String(value || "").replace(/\u200e|\u200f/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function activeChatTitle(){
  const main = document.querySelector("#main") || document.querySelector("main") || document.querySelector('[role="main"]');
  const titled = main?.querySelector('header [data-testid="conversation-info-header-chat-title"]')
    || main?.querySelector('header span[dir="auto"]');
  return cleanText(titled?.textContent || titled?.getAttribute("title") || "");
}

function comparableText(value){
  return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizedUiText(value){
  return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function sameCustomer(title, request){
  const active = comparableText(title);
  const expectedName = comparableText(request?.customerName);
  const activeDigits = active.replace(/\D/g, "");
  const expectedDigits = String(request?.phone || "").replace(/\D/g, "");
  if(expectedDigits && activeDigits && activeDigits.endsWith(expectedDigits.slice(-10))) return true;
  const tokens = expectedName.split(" ").filter(token=>token.length >= 3);
  if(!tokens.length) return false;
  const required = Math.min(2, tokens.length);
  return tokens.filter(token=>active.includes(token)).length >= required;
}

function voiceMessageNodes(main){
  return loadedMessageNodes(main).filter(node=>
    node.querySelector('[aria-label="Mensagem de voz"], [aria-label*="voice message" i], [data-testid="audio-download"]')
  );
}

function loadedMessageNodes(main){
  const containers = [...main.querySelectorAll('[data-testid^="conv-msg-"]')]
    .filter(node=>!node.querySelector('[data-testid="system_message"]'));
  if(containers.length) return containers;
  return [...main.querySelectorAll("[data-pre-plain-text]")];
}

function olderMessagesButton(main){
  const phrases = [
    "clique neste aviso para carregar mensagens mais antigas do seu celular",
    "click this message to load older messages from your phone"
  ];
  return [...main.querySelectorAll("button,[role='button']")].find(button=>{
    const text = normalizedUiText(button.textContent);
    return phrases.some(phrase=>text.includes(normalizedUiText(phrase)));
  }) || null;
}

async function loadOlderMessagesFromPhone(main){
  const button = olderMessagesButton(main);
  if(!button) return {requested:false, loaded:false};
  const before = loadedMessageNodes(main).length;
  button.click();
  const deadline = Date.now() + 20000;
  while(Date.now() < deadline){
    await new Promise(resolve=>setTimeout(resolve, 800));
    if(!olderMessagesButton(main)){
      return {requested:true, loaded:true, before, after:loadedMessageNodes(main).length};
    }
  }
  return {requested:true, loaded:false, before, after:loadedMessageNodes(main).length};
}

function profilePhotoUrl(main){
  const image = main?.querySelector('header[data-testid="conversation-header"] img') || main?.querySelector("header img");
  const source = String(image?.getAttribute("src") || "").trim();
  return /^(https:|data:image\/)/i.test(source) ? source : "";
}

function conversationUnavailable(){
  const text = normalizedUiText(document.body?.innerText || "");
  return [
    "o numero de telefone compartilhado atraves do link e invalido",
    "este numero de telefone nao esta no whatsapp",
    "phone number shared via url is invalid",
    "this phone number isnt on whatsapp",
    "this phone number is not on whatsapp"
  ].some(phrase=>text.includes(normalizedUiText(phrase)));
}

function chatLoadState(request={}){
  const main = document.querySelector("#main") || document.querySelector("main") || document.querySelector('[role="main"]');
  if(!main) return {ready:false, title:"", count:0, unavailable:conversationUnavailable()};
  const title = activeChatTitle();
  const count = loadedMessageNodes(main).length;
  return {
    ready:Boolean(title && count),
    empty:Boolean(title && !count),
    title,
    count,
    matches:sameCustomer(title, request),
    profilePhotoUrl:profilePhotoUrl(main),
    olderMessagesAvailable:Boolean(olderMessagesButton(main)),
    unavailable:conversationUnavailable()
  };
}

function transcriptFromNode(node){
  const whisperResult = node.querySelector(".wt-transcription-result:not(.error) .wt-result-text");
  const parakeetResult = node.querySelector(".parakeet-wa-transcribe-result span");
  return cleanText(whisperResult?.textContent || parakeetResult?.textContent || "");
}

function transcriptionFailed(node){
  if(node.querySelector(".wt-transcription-result.error")) return true;
  const parakeetText = cleanText(node.querySelector(".parakeet-wa-transcribe-result span")?.textContent || "");
  return /failed|error|erro|limit/i.test(parakeetText);
}

async function transcribeCompatibleAudios(main){
  const voiceNodes = voiceMessageNodes(main);
  const pending = voiceNodes.filter(node=>!transcriptFromNode(node) && !transcriptionFailed(node));
  let started = 0;
  for(const node of pending){
    const button = node.querySelector(".wt-transcribe-btn:not(.success), .parakeet-wa-transcribe-btn");
    if(button && !button.disabled){
      button.click();
      started += 1;
    }
  }
  if(!started) return {voiceCount:voiceNodes.length, compatible:voiceNodes.some(node=>node.querySelector(".wt-btn-container, .parakeet-wa-transcribe-container"))};

  const deadline = Date.now() + 12000;
  while(Date.now() < deadline){
    const unfinished = voiceNodes.filter(node=>!transcriptFromNode(node) && !transcriptionFailed(node));
    if(!unfinished.length) break;
    await new Promise(resolve=>setTimeout(resolve, 750));
  }
  return {voiceCount:voiceNodes.length, compatible:true};
}

async function extractLoadedMessages(){
  const main = document.querySelector("#main") || document.querySelector("main") || document.querySelector('[role="main"]');
  if(!main) throw new Error("Abra uma conversa no WhatsApp Web antes de capturar.");

  const olderHistory = await loadOlderMessagesFromPhone(main);
  const transcription = await transcribeCompatibleAudios(main);

  const nodes = loadedMessageNodes(main);
  if(!nodes.length) throw new Error("A conversa ainda não carregou. Aguarde alguns segundos e tente novamente.");

  const seen = new Set();
  const messages = [];
  let audioCount = 0;
  for(const node of nodes){
    const detailNode = node.hasAttribute("data-pre-plain-text") ? node : node.querySelector("[data-pre-plain-text]");
    const prefix = cleanText(detailNode?.getAttribute("data-pre-plain-text"));
    const hasVoiceMessage = !!node.querySelector('[aria-label="Mensagem de voz"], [aria-label*="voice message" i], [data-testid="audio-download"]');
    const bodyNode = detailNode || node;
    let body = cleanText(bodyNode.innerText || bodyNode.textContent);
    if(hasVoiceMessage){
      audioCount += 1;
      const transcript = transcriptFromNode(node);
      body = transcript ? `[Transcrição de áudio] ${transcript}` : "[Áudio sem transcrição]";
    }
    if(!body) continue;
    const line = `${prefix}${prefix && !prefix.endsWith(" ") ? " " : ""}${body}`.trim();
    if(seen.has(line)) continue;
    seen.add(line);
    messages.push(line);
  }

  if(!messages.length) throw new Error("Não encontrei mensagens de texto carregadas nesta conversa.");
  const maximum = 500;
  const selected = messages.slice(-maximum);
  return {
    transcript:selected.join("\n"),
    count:selected.length,
    audioCount,
    audioTranscribed:voiceMessageNodes(main).filter(node=>!!transcriptFromNode(node)).length,
    audioExtensionDetected:transcription.compatible,
    olderHistoryRequested:olderHistory.requested,
    olderHistoryLoaded:olderHistory.loaded,
    profilePhotoUrl:profilePhotoUrl(main),
    limited:messages.length >= maximum
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type === "criare-chat-load-state"){
    sendResponse({ok:true, extensionVersion:chrome.runtime.getManifest().version, ...chatLoadState(message.request || {})});
    return false;
  }
  if(message?.type !== "criare-extract-active-chat") return false;
  (async ()=>{
    try{
      const title = activeChatTitle();
      if(!message.request?.trustedTarget && !sameCustomer(title, message.request || {})){
        const expected = cleanText(message.request?.customerName) || "o cliente do CRM";
        sendResponse({
          ok:false,
          mismatch:true,
          title:title || "não identificada",
          extensionVersion:chrome.runtime.getManifest().version,
          error:`A conversa aberta é “${title || "não identificada"}”, mas o cliente no CRM é “${expected}”.`
        });
        return;
      }
      const extracted = await extractLoadedMessages();
      sendResponse({ok:true, title, extensionVersion:chrome.runtime.getManifest().version, ...extracted});
    }catch(error){
      sendResponse({
        ok:false,
        extensionVersion:chrome.runtime.getManifest().version,
        error:error.message || "Não foi possível ler a conversa aberta."
      });
    }
  })();
  return true;
});
