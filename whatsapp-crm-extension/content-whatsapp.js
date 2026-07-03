function cleanText(value){
  return String(value || "").replace(/\u200e|\u200f/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function activeChatTitle(){
  const main = document.querySelector("#main") || document.querySelector("main") || document.querySelector('[role="main"]');
  const titled = main?.querySelector("header [title]");
  return cleanText(titled?.getAttribute("title") || titled?.textContent || "");
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

function extractLoadedMessages(){
  const main = document.querySelector("#main") || document.querySelector("main") || document.querySelector('[role="main"]');
  if(!main) throw new Error("Abra uma conversa no WhatsApp Web antes de capturar.");

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
      const looksLikeTranscript = body.length > 35 && !/^(\d{1,2}:\d{2}|mensagem de voz)$/i.test(body);
      body = looksLikeTranscript ? `[Transcrição de áudio] ${body}` : "[Áudio sem transcrição]";
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
    limited:messages.length >= maximum
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type !== "criare-extract-active-chat") return false;
  try{
    const title = activeChatTitle();
    if(!sameCustomer(title, message.request || {})){
      const expected = cleanText(message.request?.customerName) || "o cliente do CRM";
      throw new Error(`A conversa aberta é “${title || "não identificada"}”, mas o cliente no CRM é “${expected}”. Abra a conversa correta antes de capturar.`);
    }
    const extracted = extractLoadedMessages();
    sendResponse({ok:true, title, ...extracted});
  }catch(error){
    sendResponse({ok:false, error:error.message || "Não foi possível ler a conversa aberta."});
  }
  return false;
});
