function cleanText(value){
  return String(value || "").replace(/\u200e|\u200f/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function activeChatTitle(){
  const main = document.querySelector("#main") || document.querySelector("main") || document.querySelector('[role="main"]');
  const titled = main?.querySelector("header [title]");
  return cleanText(titled?.getAttribute("title") || titled?.textContent || "");
}

function extractLoadedMessages(){
  const main = document.querySelector("#main") || document.querySelector("main") || document.querySelector('[role="main"]');
  if(!main) throw new Error("Abra uma conversa no WhatsApp Web antes de capturar.");

  const nodes = [...main.querySelectorAll("[data-pre-plain-text]")];
  if(!nodes.length) throw new Error("A conversa ainda não carregou. Aguarde alguns segundos e tente novamente.");

  const seen = new Set();
  const messages = [];
  for(const node of nodes){
    const prefix = cleanText(node.getAttribute("data-pre-plain-text"));
    const body = cleanText(node.innerText || node.textContent);
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
    limited:messages.length >= maximum
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type !== "criare-extract-active-chat") return false;
  try{
    const extracted = extractLoadedMessages();
    sendResponse({ok:true, title:activeChatTitle(), ...extracted});
  }catch(error){
    sendResponse({ok:false, error:error.message || "Não foi possível ler a conversa aberta."});
  }
  return false;
});
