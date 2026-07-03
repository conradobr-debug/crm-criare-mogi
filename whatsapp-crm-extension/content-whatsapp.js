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
  return [...main.querySelectorAll("[data-pre-plain-text]")].filter(node=>
    node.querySelector('[aria-label="Mensagem de voz"], [aria-label*="voice message" i], [data-testid="audio-download"]')
  );
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

  const transcription = await transcribeCompatibleAudios(main);

  const nodes = [...main.querySelectorAll("[data-pre-plain-text]")];
  if(!nodes.length) throw new Error("A conversa ainda não carregou. Aguarde alguns segundos e tente novamente.");

  const seen = new Set();
  const messages = [];
  let audioCount = 0;
  for(const node of nodes){
    const prefix = cleanText(node.getAttribute("data-pre-plain-text"));
    const hasVoiceMessage = !!node.querySelector('[aria-label="Mensagem de voz"], [aria-label*="voice message" i], [data-testid="audio-download"]');
    let body = cleanText(node.innerText || node.textContent);
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
    limited:messages.length >= maximum
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
