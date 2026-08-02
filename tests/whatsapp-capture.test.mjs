import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const coreSource = await readFile(new URL("whatsapp-crm-extension/capture-core.js", root), "utf8");
const context = {globalThis:{}};
vm.runInNewContext(coreSource, context);
const core = context.globalThis.CriareWhatsAppCaptureCore;
const matcherSource = await readFile(new URL("audio-import-matcher.js", root), "utf8");
const matcherContext = {globalThis:{CriareWhatsAppCaptureCore:core}};
vm.runInNewContext(matcherSource, matcherContext);
const matcher = matcherContext.globalThis.CriareAudioImportMatcher;
assert.equal(matcher.version,"2.2.6");
const contentSource = await readFile(new URL("whatsapp-crm-extension/content-whatsapp.js", root), "utf8");
const hydrationContext = {
  globalThis:{CriareWhatsAppCaptureCore:core,__CRIARE_WHATSAPP_TEST__:true,CriarePhoneIdentity:{comparableDigits:value=>String(value||"").replace(/\D/g,""),normalizePhone:value=>({normalized_e164:`+${String(value||"").replace(/\D/g,"")}`})}},
  chrome:{runtime:{getManifest:()=>({version:"test"}),onMessage:{addListener(){}}}},
  document:{body:null},
  console
};
vm.runInNewContext(contentSource, hydrationContext);
const hydration = hydrationContext.globalThis.CriareWhatsAppHydrationTest;
const capture = hydrationContext.globalThis.CriareWhatsAppCaptureTest;
assert.ok(hydration?.createHistoryHydrationTracker);
assert.ok(capture?.isWhatsAppSystemMessage);
assert.ok(capture?.hasAudioEvidence);

function hydrationSnapshot(ids,{panelToken="main",scrollerFound=true,reachedStartEvidence=false,loading=false}={}){
  return {ids,panelToken,scrollerFound,reachedStartEvidence,loading};
}

test("preserva mensagens repetidas quando os IDs do WhatsApp são diferentes",()=>{
  const merged = core.mergeEntries([], [
    {id:"wa:1",text:"[10:00, 01/07/2026] Cliente: Obrigada"},
    {id:"wa:2",text:"[10:00, 01/07/2026] Cliente: Obrigada"}
  ]);
  assert.equal(merged.entries.length,2);
  assert.equal(merged.addedCount,2);
});

test("combina múltiplas janelas virtualizadas somente pelo message_id canônico",()=>{
  const newest=[
    {id:"wa:M3",message_id:"M3",text:"[10:03, 25/06/2026] Raquel: terceira"},
    {id:"wa:M4",message_id:"M4",text:"[10:04, 25/06/2026] Você: repetida"}
  ];
  const middle=[
    {id:"wa:M2",message_id:"M2",text:"[10:02, 25/06/2026] Você: repetida"},
    {id:"wa:M3",message_id:"wa:M3",text:"[10:03, 25/06/2026] Raquel: terceira"}
  ];
  const oldest=[
    {id:"wa:M1",message_id:"M1",text:"[09:59, 24/06/2026] Raquel: primeira"},
    {id:"wa:M2",message_id:"M2",text:"[10:02, 25/06/2026] Você: repetida"}
  ];
  const first=core.mergeMessageWindow(newest,middle,{prepend:true});
  const complete=core.mergeMessageWindow(first.entries,oldest,{prepend:true});
  assert.deepEqual(Array.from(complete.entries,entry=>entry.message_id),["M1","M2","M3","M4"]);
  assert.equal(new Set(complete.entries.map(entry=>entry.message_id)).size,4);
});

test("preserva múltiplos áudios distintos entre janelas virtualizadas",()=>{
  const first=core.mergeMessageWindow([],Array.from({length:13},(_,index)=>({message_id:`AUDIO-${index}`,id:`wa:AUDIO-${index}`,type:"Áudio",text:"[Áudio sem transcrição]"})),{prepend:true});
  const second=core.mergeMessageWindow(first.entries,Array.from({length:13},(_,index)=>({message_id:`AUDIO-${index+13}`,id:`wa:AUDIO-${index+13}`,type:"Áudio",text:"[Áudio sem transcrição]"})),{prepend:false});
  assert.equal(second.entries.length,26);
  assert.equal(new Set(second.entries.map(entry=>entry.message_id)).size,26);
});

test("aguarda a hidratação tardia antes de aceitar o histórico",()=>{
  const tracker=hydration.createHistoryHydrationTracker({minWaitMs:1000,minStableSamples:3});
  const transient=["M1"];
  assert.equal(tracker.observe(hydrationSnapshot(transient),0).hydrated,false);
  assert.equal(tracker.observe(hydrationSnapshot(transient),400).hydrated,false);
  assert.equal(tracker.observe(hydrationSnapshot(transient),800).hydrated,false);
  const complete=[...Array.from({length:37},(_,index)=>`TEXT-${index}`),...Array.from({length:6},(_,index)=>`AUDIO-${index}`)];
  assert.equal(tracker.observe(hydrationSnapshot(complete),1200).stableSamples,1);
  assert.equal(tracker.observe(hydrationSnapshot(complete),1600).hydrated,false);
  const final=tracker.observe(hydrationSnapshot(complete),2000);
  assert.equal(final.hydrated,true);
  assert.equal(final.finalCount,43);
  assert.equal(new Set(complete.filter(id=>id.startsWith("AUDIO-"))).size,6);
});

test("não aceita uma mensagem estável por mais de 4,5 segundos antes do histórico completo",()=>{
  const tracker=hydration.createHistoryHydrationTracker({minWaitMs:4500,minStableSamples:3,timeoutMs:12000});
  const transient=hydrationSnapshot(["TRANSIENT-ONE"],{reachedStartEvidence:true});
  for(const elapsed of [0,450,900,1350,1800,2250,2700,3150,3600,4050,4500,4950,5400,5850,6300,6750]){
    assert.equal(tracker.observe(transient,elapsed).hydrated,false,`não deve aceitar uma mensagem em ${elapsed}ms`);
  }
  const complete=[...Array.from({length:37},(_,index)=>`TEXT-${index+1}`),...Array.from({length:6},(_,index)=>`AUDIO-${index+1}`)];
  const snapshot=hydrationSnapshot(complete,{reachedStartEvidence:true});
  assert.equal(tracker.observe(snapshot,7200).hydrated,false);
  assert.equal(tracker.observe(snapshot,7650).hydrated,false);
  const accepted=tracker.observe(snapshot,8100);
  assert.equal(accepted.hydrated,true);
  assert.equal(accepted.reason,"stable_canonical_ids");
  assert.equal(accepted.finalCount,43);
  assert.equal(complete.filter(id=>id.startsWith("AUDIO-")).length,6);
});

test("aceita conversa legítima de uma mensagem somente no final do timeout completo",()=>{
  const tracker=hydration.createHistoryHydrationTracker({minWaitMs:1000,minStableSamples:3});
  const snapshot=hydrationSnapshot(["ONLY-1"],{reachedStartEvidence:true});
  assert.equal(tracker.observe(snapshot,0).hydrated,false);
  assert.equal(tracker.observe(snapshot,500).hydrated,false);
  const early=tracker.observe(snapshot,1100);
  assert.equal(early.hydrated,false);
  assert.equal(early.reason,"single_message_waiting_full_timeout");
  const accepted=tracker.final(12000);
  assert.equal(accepted.hydrated,true);
  assert.equal(accepted.reason,"single_message_start_confirmed_after_full_timeout");
});

test("painel ambíguo com uma mensagem retorna history_not_hydrated sem payload parcial",()=>{
  const tracker=hydration.createHistoryHydrationTracker({minWaitMs:900,minStableSamples:3});
  for(const elapsed of [0,450,1000,1450]) tracker.observe(hydrationSnapshot(["TRANSIENT"],{reachedStartEvidence:false}),elapsed);
  const failure=tracker.final(1600);
  assert.equal(failure.hydrated,false);
  assert.equal(failure.reason,"single_message_start_not_confirmed");
  const payload=failure.hydrated?{entries:["TRANSIENT"]}:null;
  assert.equal(payload,null);
});

test("tentativa não hidratada preserva o histórico anterior",()=>{
  const previous=Array.from({length:43},(_,index)=>({message_id:`M-${index}`,id:`wa:M-${index}`,text:`mensagem ${index}`}));
  const tracker=hydration.createHistoryHydrationTracker({minWaitMs:900,minStableSamples:3});
  [0,450,1000].forEach(elapsed=>tracker.observe(hydrationSnapshot(["TRANSIENT"],{reachedStartEvidence:false}),elapsed));
  const failed=tracker.final(1400);
  const persisted=failed.hydrated?core.mergeEntries(previous,[{message_id:"TRANSIENT",text:"parcial"}]).entries:previous;
  assert.equal(persisted.length,43);
  assert.equal(persisted[0].message_id,"M-0");
});

test("reinicia a estabilidade a cada crescimento progressivo do DOM",()=>{
  const tracker=hydration.createHistoryHydrationTracker({minWaitMs:1000,minStableSamples:3});
  let elapsed=0;
  for(const count of [1,8,25,43]){
    const observed=tracker.observe(hydrationSnapshot(Array.from({length:count},(_,index)=>`M-${index}`)),elapsed);
    assert.equal(observed.stableSamples,1);
    assert.equal(observed.hydrated,false);
    elapsed+=400;
  }
  assert.equal(tracker.observe(hydrationSnapshot(Array.from({length:43},(_,index)=>`M-${index}`)),elapsed).hydrated,false);
  const final=tracker.observe(hydrationSnapshot(Array.from({length:43},(_,index)=>`M-${index}`)),elapsed+400);
  assert.equal(final.hydrated,true);
});

test("troca do painel reinicia a observação e descarta a referência antiga",()=>{
  const tracker=hydration.createHistoryHydrationTracker({minWaitMs:1000,minStableSamples:3});
  tracker.observe(hydrationSnapshot(["OLD-1"],{panelToken:"old",reachedStartEvidence:false}),0);
  tracker.observe(hydrationSnapshot(["OLD-1"],{panelToken:"old",reachedStartEvidence:false}),400);
  const current=Array.from({length:43},(_,index)=>`NEW-${index}`);
  const replaced=tracker.observe(hydrationSnapshot(current,{panelToken:"new"}),1200);
  assert.equal(replaced.stableSamples,1);
  assert.equal(replaced.hydrated,false);
  tracker.observe(hydrationSnapshot(current,{panelToken:"new"}),1600);
  const final=tracker.observe(hydrationSnapshot(current,{panelToken:"new"}),2000);
  assert.equal(final.hydrated,true);
  assert.equal(final.finalCount,43);
});

test("atualiza mensagem editada sem duplicar o ID",()=>{
  const merged = core.mergeEntries(
    [{id:"wa:1",text:"[10:00, 01/07/2026] Cliente: segunda"}],
    [{id:"wa:1",text:"[10:00, 01/07/2026] Cliente: terça"}]
  );
  assert.equal(merged.entries.length,1);
  assert.equal(merged.updatedCount,1);
  assert.match(merged.entries[0].text,/terça/);
});

test("uma releitura de texto remove marcador de áudio falso do mesmo message_id",()=>{
  const merged=core.mergeEntries(
    [{id:"wa:MSG-0929",message_id:"MSG-0929",type:"Áudio",hasVoiceMessage:true,text:"[Áudio sem transcrição]",audioMeta:{extractionStatus:"pending"},duration:null}],
    [{id:"wa:MSG-0929",message_id:"MSG-0929",type:"Texto",hasVoiceMessage:false,text:"[09:29, 27/07/2026] Criare: certinho...fico a disposição!"}]
  );
  assert.equal(merged.entries.length,1);
  assert.equal(merged.entries[0].type,"Texto");
  assert.equal(merged.entries[0].hasVoiceMessage,undefined);
  assert.equal(merged.entries[0].audioMeta,undefined);
  assert.match(merged.entries[0].text,/certinho/);
});

function fakeCaptureNode({text="",prePlainText="",dataId="",systemMarker=false}={}){
  return {
    textContent:text,
    innerText:text,
    getAttribute(name){return name==="data-pre-plain-text"?prePlainText:name==="data-id"?dataId:"";},
    matches(selector){return systemMarker&&/system|notification|encryption|e2e|separator/.test(selector);},
    closest(){return null;},
    querySelector(){return null;},
    querySelectorAll(){return [];}
  };
}

test("aviso de criptografia não entra no transcript: três mensagens reais permanecem três",()=>{
  const encryption=fakeCaptureNode({
    text:"As mensagens e ligações são protegidas com a criptografia de ponta a ponta. Somente as pessoas que fazem parte desta conversa podem ler, ouvir ou compartilhar.",
    systemMarker:true
  });
  const messages=["primeira","segunda","terceira"].map((text,index)=>fakeCaptureNode({text,prePlainText:`[10:0${index}, 27/07/2026] Você: `,dataId:`true_5519999999999@c.us_MSG${index}ABC`}));
  const transcript=[...messages,encryption].filter(node=>!capture.isWhatsAppSystemMessage(node)).map(node=>node.textContent).join("\n");
  assert.equal(capture.isWhatsAppSystemMessage(encryption),true);
  assert.equal(transcript.split("\n").length,3);
  assert.doesNotMatch(transcript,/criptografia de ponta a ponta/i);
  assert.equal(["primeira","segunda","terceira"].filter(text=>/\[Áudio sem transcrição\]/.test(text)).length,0);
});

test("linha portuguesa de criptografia é reconhecida isoladamente após normalização",()=>{
  assert.equal(capture.isWhatsAppSystemMessageText("As mensagens e ligações são protegidas com a criptografia de ponta a ponta."),true);
});

test("linha portuguesa de participantes é reconhecida isoladamente após normalização",()=>{
  assert.equal(capture.isWhatsAppSystemMessageText("Somente as pessoas que fazem parte da conversa podem ler, ouvir e compartilhar o conteúdo dessas conversas."),true);
});

test("clique para saber mais isolado é reconhecido como aviso do WhatsApp",()=>{
  assert.equal(capture.isWhatsAppSystemMessageText("Clique para saber mais"),true);
});

test("aviso completo em português é reconhecido",()=>{
  assert.equal(capture.isWhatsAppSystemMessageText("As mensagens e ligações são protegidas com a criptografia de ponta a ponta. Somente as pessoas que fazem parte da conversa podem ler, ouvir e compartilhar o conteúdo dessas conversas. Clique para saber mais."),true);
});

test("avisos equivalentes em inglês e espanhol são reconhecidos",()=>{
  assert.equal(capture.isWhatsAppSystemMessageText("Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them."),true);
  assert.equal(capture.isWhatsAppSystemMessageText("Los mensajes y las llamadas están protegidos con el cifrado de extremo a extremo. Solo las personas que forman parte de esta conversación pueden leer, escuchar y compartir el contenido."),true);
});

test("mensagem comercial com segurança não é confundida com aviso do WhatsApp",()=>{
  assert.equal(capture.isWhatsAppSystemMessageText("Nossa segurança no projeto é prioridade; posso explicar as opções para sua cozinha."),false);
});


test("messageNodes retorna somente as três mensagens reais e exclui o aviso estrutural",()=>{
  const makeNode=(id,text,{system=false}={})=>{
    const detail={getAttribute:name=>name==="data-pre-plain-text"?`[10:00, 27/07/2026] Você: `:""};
    return {
      textContent:text,innerText:text,parentElement:null,children:[],
      hasAttribute(name){return name==="data-id"&&Boolean(id);},
      getAttribute(name){return name==="data-id"?id:name==="data-pre-plain-text"&&id?detail.getAttribute(name):"";},
      matches(selector){return selector.includes('[data-testid="msg-container"]')||(!system&&selector.includes('[data-pre-plain-text]'));},
      closest(){return null;},
      contains(other){return other===this;},
      querySelector(selector){return !system&&selector.includes('[data-pre-plain-text]')?detail:null;},
      querySelectorAll(){return [];}
    };
  };
  const real=[0,1,2].map(index=>makeNode(`true_5519999999999@c.us_3A5FBC1234567890ABCDEF12345678${index}`,`mensagem ${index}`));
  const system=makeNode("","ic-lock-filledAs mensagens e ligações são protegidas com a criptografia de ponta a ponta. Clique para saber mais.",{system:true});
  const all=[...real,system];
  const main={querySelectorAll(selector){if(selector===capture.voiceSelector)return[];if(selector.includes('conv-msg')||selector.includes('[data-testid="msg-container"]'))return all;return[];}};
  const selected=capture.messageNodes(main);
  assert.equal(selected.length,3);
  assert.deepEqual(Array.from(selected,node=>node.textContent),["mensagem 0","mensagem 1","mensagem 2"]);
});

test("aviso real dentro de msg-container continua sendo sistema sem evidência forte",()=>{
  const node={
    textContent:"ic-lock-filledAs mensagens e ligações são protegidas com a criptografia de ponta a ponta. Somente as pessoas que fazem parte da conversa podem ler, ouvir e compartilhar o conteúdo dessas conversas. Clique para saber mais.",
    innerText:"ic-lock-filledAs mensagens e ligações são protegidas com a criptografia de ponta a ponta. Somente as pessoas que fazem parte da conversa podem ler, ouvir e compartilhar o conteúdo dessas conversas. Clique para saber mais.",
    parentElement:null,
    children:[],
    hasAttribute(){return false;},
    getAttribute(){return "";},
    matches(selector){return selector.includes('[data-testid="msg-container"]')||selector.includes('.message-in');},
    closest(){return null;},
    querySelector(){return null;},
    querySelectorAll(){return [];}
  };
  assert.equal(capture.isWhatsAppSystemMessage(node),true);
});

test("aviso do sistema não vira mensagem real ao herdar data-id e pre-plain-text de um wrapper",()=>{
  const inheritedDetail={getAttribute:name=>name==="data-pre-plain-text"?"[10:40, 27/07/2026] Você: ":""};
  const wrapper={
    getAttribute:name=>name==="data-id"?"true_5519999999999@c.us_3A5FBC1234567890ABCDEF1234567890":"",
    querySelector:selector=>selector.includes('[data-pre-plain-text]')?inheritedDetail:null,
    querySelectorAll:()=>[],parentElement:null
  };
  const notice={
    textContent:"As mensagens e ligações são protegidas com a criptografia de ponta a ponta.",
    innerText:"As mensagens e ligações são protegidas com a criptografia de ponta a ponta.",
    parentElement:wrapper,
    children:[],
    getAttribute(){return "";},
    hasAttribute(){return false;},
    matches(){return false;},
    closest(){return null;},
    querySelector(selector){return selector.includes('[data-pre-plain-text]')?inheritedDetail:null;},
    querySelectorAll(){return [];}
  };
  assert.equal(capture.isWhatsAppSystemMessage(notice),true);
  assert.equal(capture.isRealMessageNode(notice),false);
});

test("mensagem real com ID e pre-plain-text não é excluída mesmo citando criptografia",()=>{
  const detail={getAttribute:name=>name==="data-pre-plain-text"?"[10:00, 27/07/2026] Você: ":""};
  const node={
    textContent:"As mensagens e ligações são protegidas com criptografia; posso explicar a segurança do projeto.",
    innerText:"As mensagens e ligações são protegidas com criptografia; posso explicar a segurança do projeto.",
    parentElement:null,
    children:[],
    hasAttribute(name){return name==="data-id";},
    getAttribute(name){return name==="data-id"?"true_5519999999999@c.us_3A5FBC1234567890ABCDEF1234567890":name==="data-pre-plain-text"?"[10:00, 27/07/2026] Você: ":"";},
    matches(selector){return selector.includes('[data-testid="msg-container"]')||selector.includes('[data-pre-plain-text]');},
    closest(){return null;},
    querySelector(selector){return selector.includes('[data-pre-plain-text]')?detail:null;},
    querySelectorAll(){return [];}
  };
  assert.equal(capture.isWhatsAppSystemMessage(node),false);
});

test("conversa curta não rolável só é completa com evidências fortes",()=>{
  const complete=capture.shortNonScrollableHistoryDecision({panelFound:true,mainConnected:true,panelConnected:true,panelStable:true,loading:false,olderMessagesAvailable:false,messageCount:3,allCanonicalIds:true,panelContainsAll:true,scrollHeight:600,clientHeight:600});
  assert.equal(complete.complete,true);
  assert.equal(complete.reason,"short_non_scrollable_history_complete");
  const ambiguous=capture.shortNonScrollableHistoryDecision({panelFound:true,mainConnected:true,panelConnected:true,panelStable:true,loading:false,olderMessagesAvailable:false,messageCount:3,allCanonicalIds:false,panelContainsAll:true,scrollHeight:600,clientHeight:600});
  assert.equal(ambiguous.complete,false);
});

test("captura aberta exige confirmação manual quando o telefone não aparece e nunca aprova só pelo nome",()=>{
  const pending=capture.openCaptureIdentityDecision("Graziele (Araras)",{captureMode:"opened",phone:"5519997377797",customerName:"Graziele Souza"});
  assert.equal(pending.ok,false);
  assert.equal(pending.code,"identity_confirmation_required");
  const confirmed=capture.openCaptureIdentityDecision("Graziele (Araras)",{captureMode:"opened",phone:"5519997377797",customerName:"Graziele Souza",identityOverrideConfirmed:true});
  assert.equal(confirmed.ok,true);
  assert.equal(confirmed.identityOverrideUsed,true);
  const automatic=capture.openCaptureIdentityDecision("Graziele (Araras)",{captureMode:"automatic",phone:"5519997377797",customerName:"Graziele Souza"});
  assert.equal(automatic.ok,false);
  assert.equal(automatic.code,"contact_mismatch");
});

test("telefone E.164 confirmado vence qualquer diferença de título",()=>{
  const decision=capture.openCaptureIdentityDecision("Apelido qualquer",{captureMode:"opened",phone:"5519997377797",phoneIdentityConfirmed:true,confirmedPhone:"+5519997377797"});
  assert.equal(decision.ok,true);
});

test("Fernanda e Rose removem somente sistema e áudio órfão em captura aberta completa",()=>{
  const makeReal=(prefix,count)=>Array.from({length:count},(_,index)=>({id:`wa:${prefix}-${index}`,message_id:`AABBCCDDEEFF${String(index).padStart(4,"0")}`,type:"Texto",text:`[10:0${index}, 27/07/2026] Criare: mensagem ${index}`}));
  for(const [name,count] of [["FERNANDA",3],["ROSE",4]]){
    const incoming=makeReal(name,count);
    const stored=[...incoming,{id:`wa:DEADBEEFDEADBEEFDEADBEEFDEADBEEF`,message_id:"DEADBEEFDEADBEEFDEADBEEFDEADBEEF",text:"Autor não identificado data não identificada horário não identificado ic-lock-filledAs mensagens e ligações são protegidas com a criptografia de ponta a ponta. Clique para saber mais."},{id:`audio:${name}-ORPHAN`,message_id:`AUDIO:${name}-ORPHAN`,type:"Áudio",hasVoiceMessage:true,text:"[10:09, 27/07/2026] Criare: [Áudio sem transcrição]",audioMeta:{extractionStatus:"pending"}}];
    const withoutSystem=core.removeKnownWhatsAppSystemMessages(stored,{completeHistory:true});
    const cleaned=core.removeStaleAudioMarkers(withoutSystem,incoming,{completeHistory:true,currentCanonicalIds:incoming.map(entry=>entry.message_id)});
    assert.equal(cleaned.length,count);
    assert.equal(cleaned.filter(entry=>entry.type==="Áudio").length,0);
  }
});

test("Graziele preserva os dois áudios reais de 107 e 13 segundos",()=>{
  const texts=Array.from({length:16},(_,index)=>({message_id:`GRAZIELE-TEXT-${index}`,type:"Texto",text:`[14:${String(index).padStart(2,"0")}, 06/07/2026] Graziele: texto ${index}`}));
  const audios=[
    {message_id:"GRAZIELE-AUDIO-107",type:"Áudio",hasVoiceMessage:true,text:"[18:04, 06/07/2026] Você: [Áudio sem transcrição]",duration_seconds:107,duration_source:"whatsapp_player",duration_valid:true,audioMeta:{durationSeconds:107,durationSource:"whatsapp_player"}},
    {message_id:"GRAZIELE-AUDIO-13",type:"Áudio",hasVoiceMessage:true,text:"[08:57, 07/07/2026] Você: [Áudio sem transcrição]",duration_seconds:13,duration_source:"whatsapp_player",duration_valid:true,audioMeta:{durationSeconds:13,durationSource:"whatsapp_player"}}
  ];
  const system={id:"fp:GRAZIELE-SYSTEM",text:"ic-lock-filledAs mensagens e ligações são protegidas com a criptografia de ponta a ponta. Clique para saber mais."};
  const incoming=[...texts,...audios];
  const cleanedSystem=core.removeKnownWhatsAppSystemMessages([...incoming,system],{completeHistory:true});
  const cleaned=core.removeStaleAudioMarkers(cleanedSystem,incoming,{completeHistory:true,currentCanonicalIds:incoming.map(entry=>entry.message_id)});
  assert.equal(cleaned.length,18);
  assert.deepEqual(cleaned.filter(entry=>entry.type==="Áudio").map(entry=>entry.duration_seconds),[107,13]);
});

test("slider isolado não cria áudio, mas player de áudio real continua reconhecido",()=>{
  assert.equal(capture.hasAudioEvidence({playControlPresent:true,durationValid:true}),false);
  assert.equal(capture.hasAudioEvidence({pttTestIdPresent:true,playControlPresent:false,durationValid:false}),false);
  assert.equal(capture.hasAudioEvidence({pttTestIdPresent:true,playControlPresent:true}),true);
  assert.equal(capture.hasAudioEvidence({audioElementPresent:true}),true);
  assert.equal(capture.hasAudioEvidence({voiceAriaPresent:true}),true);
});

test("captura completa remove marcador de áudio técnico quando a bolha recapturada é texto",()=>{
  const cleaned=core.removeStaleAudioMarkers(
    [{id:"audio:controle-0929",message_id:"AUDIO:CONTROLE-0929",type:"Áudio",hasVoiceMessage:true,text:"[09:29, 27/07/2026] Criare: [Áudio sem transcrição]",audioMeta:{extractionStatus:"pending"}}],
    [{id:"wa:MSG-TEXTO-0929",message_id:"MSG-TEXTO-0929",type:"Texto",hasVoiceMessage:false,text:"[09:29, 27/07/2026] Criare: certinho...fico a disposição!"}],
    {completeHistory:true,currentCanonicalIds:["MSG-TEXTO-0929"]}
  );
  assert.equal(cleaned.length,0);
});

test("captura parcial nunca remove marcador de áudio histórico",()=>{
  const stored=[{id:"audio:controle-0929",message_id:"AUDIO:CONTROLE-0929",type:"Áudio",hasVoiceMessage:true,text:"[09:29, 27/07/2026] Criare: [Áudio sem transcrição]",audioMeta:{extractionStatus:"pending"}}];
  const cleaned=core.removeStaleAudioMarkers(stored,[{id:"wa:MSG-TEXTO-0929",message_id:"MSG-TEXTO-0929",type:"Texto",text:"[09:29, 27/07/2026] Criare: texto"}],{completeHistory:false});
  assert.equal(cleaned.length,1);
});

test("captura completa preserva áudio real sem transcrição quando não há texto correspondente",()=>{
  const kept=core.removeStaleAudioMarkers(
    [{id:"wa:AUDIO-0854",message_id:"AUDIO-0854",type:"Áudio",hasVoiceMessage:true,text:"[08:54, 27/07/2026] Cristina: [Áudio sem transcrição]",duration:29,audioMeta:{durationSeconds:29,extractionStatus:"pending"}}],
    [{id:"wa:TEXTO-0852",message_id:"TEXTO-0852",type:"Texto",text:"[08:52, 27/07/2026] Criare: uma ótima semana!"}],
    {completeHistory:true,currentCanonicalIds:["AUDIO-0854","TEXTO-0852"]}
  );
  assert.equal(kept.length,1);
  assert.equal(kept[0].message_id,"AUDIO-0854");
});

test("caso Paty preserva 43 mensagens e seis áudios reais na captura completa",()=>{
  const texts=Array.from({length:37},(_,index)=>({message_id:`PATY-TEXT-${index}`,type:"Texto",text:`[10:${String(index).padStart(2,"0")}, 27/07/2026] Paty: texto ${index}`}));
  const audios=Array.from({length:6},(_,index)=>({message_id:`PATY-AUDIO-${index}`,type:"Áudio",hasVoiceMessage:true,text:`[11:${String(index).padStart(2,"0")}, 27/07/2026] Você: [Áudio sem transcrição]`,duration_seconds:20+index,duration_source:"whatsapp_player",duration_valid:true,audioMeta:{durationSeconds:20+index,durationSource:"whatsapp_player",extractionStatus:"pending"}}));
  const all=[...texts,...audios];
  const cleaned=core.removeStaleAudioMarkers(all,all,{completeHistory:true,currentCanonicalIds:all.map(entry=>entry.message_id)});
  assert.equal(cleaned.length,43);
  assert.equal(cleaned.filter(entry=>entry.type==="Áudio").length,6);
});

test("normaliza prefixo wa e preserva o identificador completo",()=>{
  assert.equal(core.normalizeWhatsAppMessageId(" wa:acf748cbdc45c89656b816fbcc3ec5d0 "),"ACF748CBDC45C89656B816FBCC3EC5D0");
});

test("associação manual fica restrita ao inventário do lead e exige confirmação",()=>{
  const inventory=matcher.buildInventory([
    {message_id:"A585938634827C21AC608F52E405AA15",type:"Áudio",sender:"Você",direction:"outgoing",date:"10/06/2026",message_time:"10:51",text:"[Áudio sem transcrição]",chronological_position:7},
    {message_id:"A574534332D0C11ED09F7DCE72DFF361",type:"Áudio",sender:"Você",direction:"outgoing",date:"11/06/2026",message_time:"13:45",text:"[Áudio sem transcrição]",chronological_position:12}
  ]);
  assert.deepEqual(Array.from(matcher.manualCandidates(inventory),item=>item.normalized_message_id),[
    "A585938634827C21AC608F52E405AA15",
    "A574534332D0C11ED09F7DCE72DFF361"
  ]);
  assert.equal(matcher.validateManualAssignments([{file_key:"arquivo-1",message_id:"A585938634827C21AC608F52E405AA15",confirmed:false}],inventory).ok,false);
  assert.deepEqual(Array.from(matcher.validateManualAssignments([{file_key:"arquivo-1",message_id:"OUTRO-LEAD",confirmed:true}],inventory).errors),["message_id_fora_do_lead"]);
});

test("associação manual bloqueia arquivo e message_id reutilizados",()=>{
  const inventory=matcher.buildInventory([
    {message_id:"MSG-1",type:"Áudio",sender:"Você",direction:"outgoing",date:"10/06/2026",message_time:"10:51",text:"[Áudio sem transcrição]"},
    {message_id:"MSG-2",type:"Áudio",sender:"Você",direction:"outgoing",date:"11/06/2026",message_time:"13:45",text:"[Áudio sem transcrição]"}
  ]);
  const result=matcher.validateManualAssignments([
    {file_key:"arquivo-1",message_id:"MSG-1",confirmed:true},
    {file_key:"arquivo-1",message_id:"MSG-1",confirmed:true}
  ],inventory);
  assert.equal(result.ok,false);
  assert(result.errors.includes("arquivo_reutilizado"));
  assert(result.errors.includes("message_id_reutilizado"));
});

test("metadado manual confirmado persiste e o player posterior preserva a transcrição",()=>{
  const manual={message_id:"MSG-AUDIO",type:"Áudio",text:"[Transcrição de áudio] conteúdo confirmado",transcript:"conteúdo confirmado",audioTranscribed:true,duration_seconds:43,duration_source:"manual_confirmed",audioMeta:{durationSeconds:43,durationSource:"manual_confirmed",transcription:"conteúdo confirmado",transcriptionStatus:"completed"}};
  const laterPlayer={message_id:"wa:MSG-AUDIO",type:"Áudio",text:"[Áudio sem transcrição]",duration_seconds:43,duration_text:"0:43",duration_source:"whatsapp_player",duration_valid:true,audioMeta:{durationSeconds:43,durationSource:"whatsapp_player"}};
  const first=core.mergeEntries([], [manual]).entries[0];
  assert.equal(first.duration_source,"manual_confirmed");
  const enriched=core.mergeEntries([first],[laterPlayer]).entries[0];
  assert.equal(enriched.duration_source,"whatsapp_player");
  assert.equal(enriched.transcript,"conteúdo confirmado");
  assert.match(enriched.text,/conteúdo confirmado/);
});

test("metadado confirmado do player não é rebaixado por captura posterior",()=>{
  const stored={id:"wa:ACF748CBDC45C89656B816FBCC3EC5D0",message_id:"wa:ACF748CBDC45C89656B816FBCC3EC5D0",type:"Áudio",text:"[Áudio sem transcrição]",duration_seconds:17,duration_text:"0:17",duration_source:"whatsapp_player",duration_valid:true,audioMeta:{durationSeconds:17,durationSource:"whatsapp_player"}};
  const incoming={id:"wa:ACF748CBDC45C89656B816FBCC3EC5D0",message_id:"ACF748CBDC45C89656B816FBCC3EC5D0",type:"Áudio",text:"[Áudio sem transcrição]",duration_seconds:626,duration_source:"legacy_invalid",duration_valid:false,audioMeta:{durationSeconds:626,durationSource:"legacy_invalid"}};
  const merged=core.mergeEntries([stored],[incoming]);
  assert.equal(merged.entries.length,1);
  assert.equal(merged.entries[0].message_id,"ACF748CBDC45C89656B816FBCC3EC5D0");
  assert.equal(merged.entries[0].duration_seconds,17);
  assert.equal(merged.entries[0].duration_text,"0:17");
  assert.equal(merged.entries[0].duration_source,"whatsapp_player");
  assert.equal(merged.entries[0].audioMeta.durationSeconds,17);
});

test("metadado confirmado do player substitui legado no mesmo message_id",()=>{
  const merged=core.mergeEntries(
    [{id:"wa:AC5A327CB215EB7B5EF11FB5A20E248B",type:"Áudio",text:"[Áudio sem transcrição]",duration_seconds:624,duration_source:"legacy_invalid",duration_valid:false}],
    [{id:"AC5A327CB215EB7B5EF11FB5A20E248B",message_id:"AC5A327CB215EB7B5EF11FB5A20E248B",type:"Áudio",text:"[Áudio sem transcrição]",duration_seconds:38,duration_text:"0:38",duration_source:"whatsapp_player",duration_valid:true,audioMeta:{durationSeconds:38,durationSource:"whatsapp_player"}}]
  );
  assert.equal(merged.entries.length,1);
  assert.equal(merged.entries[0].duration_seconds,38);
  assert.equal(merged.entries[0].duration_source,"whatsapp_player");
});

test("áudios idênticos com identidade própria não são colapsados",()=>{
  const audios=Array.from({length:8},(_,index)=>({id:`audio:crislane:${index}`,text:"[Áudio sem transcrição]",type:"Áudio",duration:12,sender:"Crislaine",chronological_position:index}));
  const first=core.mergeEntries([],audios);
  const repeated=core.mergeEntries(first.entries,audios);
  assert.equal(first.entries.length,8);
  assert.equal(repeated.entries.length,8);
});

test("converte somente a duração textual interna do player",()=>{
  assert.equal(core.playerDurationSeconds("0:38"),38);
  assert.equal(core.playerDurationSeconds("0:17"),17);
  assert.equal(core.playerDurationSeconds("0:27"),27);
  assert.equal(core.playerDurationSeconds("10:26 da mensagem"),null);
});

test("associa três arquivos entre todos os áudios e ignora mídia indisponível",()=>{
  const audios=[
    {id:"a1",date:"03/03/2026",time:"15:44",duration:62,sender:"Você",chronological_position:0},
    {id:"a2",date:"03/03/2026",time:"17:21",duration:21,sender:"Crislaine",chronological_position:1},
    {id:"a3",date:"04/03/2026",time:"10:24",duration:100,sender:"Você",text:"Mensagem de mídia indisponível",audioMeta:{extractionStatus:"media_unavailable"},chronological_position:2},
    {id:"a4",date:"04/03/2026",time:"10:26",duration:38,sender:"Crislaine",chronological_position:3},
    {id:"a5",date:"04/03/2026",time:"10:27",duration:17,sender:"Crislaine",chronological_position:4},
    {id:"a6",date:"04/03/2026",time:"10:28",duration:38,sender:"Você",chronological_position:5},
    {id:"a7",date:"04/03/2026",time:"10:30",duration:27,sender:"Crislaine",chronological_position:6},
    {id:"a8",date:"05/03/2026",time:"09:00",duration:25,sender:"Você",chronological_position:7}
  ];
  const files=[
    {name:"WhatsApp Ptt 2026-03-04 at 10.26.05.ogg",duration:38},
    {name:"WhatsApp Ptt 2026-03-04 at 10.27.10.ogg",duration:17},
    {name:"WhatsApp Ptt 2026-03-04 at 10.28.15.ogg",duration:38}
  ];
  const matches=files.map((file,index)=>core.audioMatchCandidates(file,audios,{fileIndex:index,fileCount:files.length}));
  assert.deepEqual(matches.map(result=>result[0].id),["a4","a5","a6"]);
  assert(matches.every(result=>result[0].score>95));
  assert(matches.every(result=>result.every(candidate=>candidate.id!=="a3")));
});

test("matching global associa os dois arquivos reais da Crislaine sem reutilizar message_id",()=>{
  const inventory=matcher.buildInventory([
    {id:"audio-out-1024",message_id:"A525",type:"Áudio",hasVoiceMessage:true,sender:"Você",direction:"outbound",date:"04/03/2026",time:"10:24",duration:22,text:"[Áudio sem transcrição] Mensagem de mídia indisponível",audioMeta:{extractionStatus:"media_unavailable"},chronological_position:0},
    {id:"audio-in-38",message_id:"AC5A327CB215EB7B5EF11FB5A20E248B",type:"Áudio",hasVoiceMessage:true,sender:"Crislaine",direction:"inbound",date:"04/03/2026",time:"10:26",duration:38,duration_seconds:38,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:1},
    {id:"audio-in-17",message_id:"ACF748CBDC45C89656B816FBCC3EC5D0",type:"Áudio",hasVoiceMessage:true,sender:"Crislaine",direction:"inbound",date:"04/03/2026",time:"10:26",duration:17,duration_seconds:17,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:2},
    {id:"legacy-empty",message_id:"LEGACY",type:"Áudio",hasVoiceMessage:true,text:"[Áudio sem transcrição]",audioMeta:{extractionStatus:"pending"},chronological_position:3}
  ]);
  const files=[
    {name:"WhatsApp Ptt 2026-03-04 at 10.26.07.ogg",duration:39},
    {name:"WhatsApp Ptt 2026-03-04 at 10.26.27.ogg",duration:17}
  ];
  const matching=matcher.matchFiles(files,inventory,{directionMode:"incoming"});
  assert.deepEqual(matching.assignments.map(item=>item.message_id),["AC5A327CB215EB7B5EF11FB5A20E248B","ACF748CBDC45C89656B816FBCC3EC5D0"]);
  assert.equal(new Set(matching.assignments.map(item=>item.message_id)).size,2);
  assert.equal(inventory.find(item=>item.normalized_message_id==="A525").exclusion_reason,"media_unavailable");
  assert.equal(inventory.find(item=>item.normalized_message_id==="LEGACY").exclusion_reason,"duracao_nao_confirmada");
  assert(matching.results.every(item=>item.assigned.score>=80));
});

test("matching elimina candidatos incompletos e durações legadas inválidas antes do score",()=>{
  const inventory=matcher.buildInventory([
    {id:"complete",message_id:"complete",type:"Áudio",sender:"Crislaine",direction:"inbound",date:"04/03/2026",time:"10:26",duration:17,duration_seconds:17,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:0},
    {id:"missing-sender",type:"Áudio",direction:"inbound",date:"04/03/2026",time:"10:26",duration:17,text:"[Áudio sem transcrição]",chronological_position:1},
    {id:"legacy-624",type:"Áudio",sender:"Crislaine",direction:"inbound",date:"04/03/2026",time:"10:26",duration:624,text:"[Áudio sem transcrição]",chronological_position:2},
    {id:"legacy-628",type:"Áudio",sender:"Crislaine",direction:"inbound",date:"04/03/2026",time:"10:27",duration:628,text:"[Áudio sem transcrição]",chronological_position:3},
    {id:"legacy-944",type:"Áudio",sender:"Crislaine",direction:"inbound",date:"04/03/2026",time:"10:28",duration:944,text:"[Áudio sem transcrição]",chronological_position:4}
  ]);
  const result=matcher.compareFile({name:"WhatsApp Ptt 2026-03-04 at 10.26.27.ogg",duration:17},inventory,{directionMode:"incoming"});
  assert.equal(result.ranked[0].normalized_message_id,"COMPLETE");
  assert.equal(result.ranked.some(item=>item.normalized_message_id==="MISSING-SENDER"),false);
  for(const id of ["LEGACY-624","LEGACY-628","LEGACY-944"]){const candidate=result.comparisons.find(item=>item.normalized_message_id===id);assert.equal(candidate.duration_source,"legacy_invalid");assert.equal(candidate.duration_valid,false);assert.equal(candidate.plausible,false);}
});

test("matching global resolve arquivos em ordem inversa e exclui enviados e indisponíveis",()=>{
  const inventory=matcher.buildInventory([
    {message_id:"IN17A",type:"Áudio",sender:"Crislaine",direction:"incoming",date:"04/03/2026",message_time:"10:26:05",duration_seconds:17,duration_source:"whatsapp_player",chronological_position:1,visual_index:1,text:"[Áudio sem transcrição]"},
    {message_id:"OUT17",type:"Áudio",sender:"Você",direction:"outgoing",date:"04/03/2026",message_time:"10:26:15",duration_seconds:17,duration_source:"whatsapp_player",chronological_position:2,visual_index:2,text:"[Áudio sem transcrição]"},
    {message_id:"IN17B",type:"Áudio",sender:"Crislaine",direction:"incoming",date:"04/03/2026",message_time:"10:26:25",duration_seconds:17,duration_source:"whatsapp_player",chronological_position:3,visual_index:3,text:"[Áudio sem transcrição]"},
    {message_id:"UNAVAILABLE",type:"Áudio",sender:"Crislaine",direction:"incoming",date:"04/03/2026",message_time:"10:26:35",duration_seconds:17,duration_source:"whatsapp_player",media_status:"media_unavailable",chronological_position:4,visual_index:4,text:"[Áudio sem transcrição]"}
  ]);
  const matching=matcher.matchFiles([
    {name:"WhatsApp Ptt 2026-03-04 at 10.26.25.ogg",duration:17,import_order:0},
    {name:"WhatsApp Ptt 2026-03-04 at 10.26.05.ogg",duration:17,import_order:1}
  ],inventory,{directionMode:"incoming"});
  assert.deepEqual(matching.assignments.map(item=>item.message_id),["IN17B","IN17A"]);
  assert.equal(new Set(matching.assignments.map(item=>item.message_id)).size,2);
  assert(matching.results.every(result=>result.comparisons.find(item=>item.normalized_message_id==="OUT17").comparison_reason==="direcao_incompativel"));
  assert(matching.results.every(result=>result.comparisons.find(item=>item.normalized_message_id==="UNAVAILABLE").comparison_reason==="media_unavailable"));
});

test("matching confirma a diferença de um dia entre nome do download e áudios do WhatsApp",()=>{
  const inventory=matcher.buildInventory([
    {message_id:"MARCIA-31",type:"Áudio",sender:"Você",direction:"outgoing",date:"23/07/2026",time:"09:54",duration_seconds:31,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:0},
    {message_id:"MARCIA-9",type:"Áudio",sender:"Márcia Guarnieri",direction:"incoming",date:"23/07/2026",time:"10:06",duration_seconds:9,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:1},
    {message_id:"MARCIA-12",type:"Áudio",sender:"Você",direction:"outgoing",date:"23/07/2026",time:"11:02",duration_seconds:12,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:2}
  ]);
  const matching=matcher.matchFiles([
    {name:"WhatsApp Ptt 2026-07-24 at 09.54.20.ogg",duration:31,import_order:0},
    {name:"WhatsApp Ptt 2026-07-24 at 10.06.11.ogg",duration:9,import_order:1},
    {name:"WhatsApp Ptt 2026-07-24 at 11.02.00.ogg",duration:12,import_order:2}
  ],inventory,{directionMode:"both"});
  assert.equal(matching.calendar_date_shift_days,-1);
  assert.deepEqual(matching.assignments.map(item=>item.message_id),["MARCIA-31","MARCIA-9","MARCIA-12"]);
  assert(matching.results.every(result=>result.assigned?.reasons.includes("data ajustada por diferença de calendário confirmada")));
});

test("preserva a diferença de calendário comprovada quando resta um único áudio pendente",()=>{
  const inventory=matcher.buildInventory([
    {message_id:"MARCIA-31",type:"Áudio",sender:"Você",direction:"outgoing",date:"23/07/2026",time:"09:54",duration_seconds:31,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:0}
  ]);
  const matching=matcher.matchFiles([
    {name:"WhatsApp Ptt 2026-07-24 at 09.54.20.ogg",duration:31,import_order:5}
  ],inventory,{directionMode:"both",calendarDateShiftMs:-24*60*60*1000});
  assert.equal(matching.calendar_date_shift_days,-1);
  assert.equal(matching.assignments[0].message_id,"MARCIA-31");
  assert.equal(matching.results[0].autoSelect,true);
});

test("associa automaticamente um download com data deslocada em um dia quando horário e duração são únicos",()=>{
  const inventory=matcher.buildInventory([
    {message_id:"KATY-46",type:"Áudio",sender:"Você",direction:"outgoing",date:"21/07/2026",time:"10:06",duration_seconds:46,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:0}
  ]);
  const matching=matcher.matchFiles([
    {name:"WhatsApp Ptt 2026-07-22 at 10.06.26.ogg",duration:46,import_order:0}
  ],inventory,{directionMode:"outgoing"});
  assert.equal(matching.assignments[0].message_id,"KATY-46");
  assert.equal(matching.results[0].autoSelect,true);
  assert(matching.results[0].assigned?.reasons.includes("data ajustada por diferença de calendário confirmada"));
});

test("matching seleciona automaticamente diferença de um segundo quando o horário confirma",()=>{
  const inventory=matcher.buildInventory([
    {message_id:"MARCIA-1103",type:"Áudio",sender:"Márcia Guarnieri",direction:"incoming",date:"23/07/2026",time:"11:03",duration_seconds:9,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:1},
    {message_id:"MARCIA-1006",type:"Áudio",sender:"Márcia Guarnieri",direction:"incoming",date:"23/07/2026",time:"10:06",duration_seconds:9,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:0},
    {message_id:"MARCIA-1102",type:"Áudio",sender:"Você",direction:"outgoing",date:"23/07/2026",time:"11:02",duration_seconds:6,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:2}
  ]);
  const matching=matcher.matchFiles([
    {name:"WhatsApp Ptt 2026-07-24 at 10.06.11.ogg",duration:9,import_order:0},
    {name:"WhatsApp Ptt 2026-07-24 at 11.02.08.ogg",duration:7,import_order:1},
    {name:"WhatsApp Ptt 2026-07-24 at 11.03.23.ogg",duration:10,import_order:2}
  ],inventory,{directionMode:"both"});
  assert.deepEqual(matching.assignments.map(item=>item.message_id),["MARCIA-1006","MARCIA-1102","MARCIA-1103"]);
  assert(matching.results.every(result=>result.autoSelect));
  assert(matching.results.every(result=>result.assigned?.reasons.includes("duração compatível (margem ≤1s)")));
});

test("duração confirmada no player substitui valor legado derivado do horário",()=>{
  const inventory=matcher.buildInventory([{id:"audio-17",type:"Áudio",sender:"Crislaine",direction:"inbound",date:"04/03/2026",time:"10:26",duration:624,duration_seconds:17,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]"}]);
  assert.equal(inventory[0].duration,17);
  assert.equal(inventory[0].duration_source,"whatsapp_player");
  assert.equal(inventory[0].duration_valid,true);
});

test("corrige Você para outgoing mesmo quando o legado diz inbound",()=>{
  const inventory=matcher.buildInventory([{id:"wa:out",message_id:"out",type:"Áudio",sender:"Você",direction:"inbound",date:"04/03/2026",time:"10:24",duration:624,text:"[Áudio sem transcrição]"}]);
  assert.equal(inventory[0].direction,"outgoing");
  assert.equal(inventory[0].duration,null);
  assert.equal(inventory[0].duration_valid,false);
  assert.equal(inventory[0].duration_source,"legacy_invalid");
});

test("normaliza wa: e remove candidato órfão com o mesmo message_id",()=>{
  const inventory=matcher.buildInventory([
    {id:"wa:ACF748CBDC45C89656B816FBCC3EC5D0",message_id:"wa:ACF748CBDC45C89656B816FBCC3EC5D0",type:"Áudio",sender:"Crislaine",direction:"incoming",date:"04/03/2026",message_time:"10:26",duration_seconds:17,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:22},
    {id:"ACF748CBDC45C89656B816FBCC3EC5D0",type:"Áudio",text:"[Áudio sem transcrição]",chronological_position:7}
  ]);
  assert.equal(inventory.length,1);
  assert.equal(inventory[0].message_id,"ACF748CBDC45C89656B816FBCC3EC5D0");
  assert.equal(inventory[0].duration,17);
  assert.equal(inventory[0].time,"10:26");
});

test("remove áudio interno órfão quando a bolha canônica está completa",()=>{
  const entries=core.pruneOrphanAudioEntries([
    {id:"wa:1BRK2J2",message_id:"1BRK2J2",type:"Áudio",text:"[Áudio sem transcrição]",direction:"incoming",message_time:"10:40"},
    {id:"wa:1FAK3DA",message_id:"1FAK3DA",type:"Áudio",text:"[Áudio sem transcrição]",sender:"Você",direction:"outgoing",date:"20/07/2026",message_time:"10:40"}
  ]);
  assert.equal(entries.length,1);
  assert.equal(entries[0].message_id,"1FAK3DA");
});

test("consolida duração do player no único registro completo da mensagem",()=>{
  const entries=core.consolidateAudioEntries([
    {id:"wa:A5BC",message_id:"A5BC",type:"Áudio",text:"[Áudio sem transcrição]",sender:"Você",direction:"outgoing",message_time:"10:40",duration_seconds:12,duration_source:"whatsapp_player",duration_valid:true},
    {id:"wa:1BRK2J2",message_id:"1BRK2J2",type:"Áudio",text:"[Áudio sem transcrição]",sender:"Você",direction:"incoming",message_time:"10:40"},
    {id:"wa:1FAK3DA",message_id:"1FAK3DA",type:"Áudio",text:"[Áudio sem transcrição]",sender:"Você",direction:"outgoing",date:"20/07/2026",message_time:"10:40"}
  ]);
  assert.equal(entries.length,1);
  assert.equal(entries[0].message_id,"1FAK3DA");
  assert.equal(entries[0].duration_seconds,12);
  assert.equal(entries[0].duration_source,"whatsapp_player");
});

test("consolida placeholders de data do player com a única bolha canônica",()=>{
  const entries=core.consolidateAudioEntries([
    {id:"wa:A5BC0F8C1493682949D17332107ACAA3",message_id:"A5BC0F8C1493682949D17332107ACAA3",type:"Áudio",text:"[Áudio sem transcrição]",sender:"Você",direction:"outgoing",date:"data não identificada",message_time:"10:40",duration_seconds:12,duration_source:"whatsapp_player",duration_valid:true},
    {id:"wa:1BRK2J2",message_id:"AUDIO:1BRK2J2",type:"Áudio",text:"[Áudio sem transcrição]",sender:"Você",direction:"outgoing",date:"data não identificada",message_time:"10:40"},
    {id:"wa:1FAK3DA",message_id:"AUDIO:1FAK3DA",type:"Áudio",text:"[Áudio sem transcrição]",sender:"Você",direction:"outgoing",date:"20/07/2026",message_time:"10:40"}
  ]);
  assert.equal(entries.length,1);
  assert.equal(entries[0].message_id,"A5BC0F8C1493682949D17332107ACAA3");
  assert.equal(entries[0].duration_seconds,12);
  assert.equal(entries[0].duration_source,"whatsapp_player");
});

test("remove os dois IDs sintéticos do CRM quando o áudio real já tem data e duração",()=>{
  const entries=core.consolidateAudioEntries([
    {id:"A5BC0F8C1493682949D17332107ACAA3",message_id:"A5BC0F8C1493682949D17332107ACAA3",type:"Áudio",text:"[Transcrição de áudio] teste",sender:"Você",direction:"outgoing",date:"20/07/2026",message_time:"10:40",duration_seconds:12,duration_source:"whatsapp_player",duration_valid:true,audioTranscribed:true,audioMeta:{transcription:"teste",transcriptionStatus:"completed"}},
    {id:"AUDIO:1BRK2J2",message_id:"AUDIO:1BRK2J2",type:"Áudio",text:"[Áudio sem transcrição]",sender:"Você",direction:"outgoing",date:"data não identificada",message_time:"10:40"},
    {id:"AUDIO:1FAK3DA",message_id:"AUDIO:1FAK3DA",type:"Áudio",text:"[Áudio sem transcrição]",sender:"Você",direction:"outgoing",date:"20/07/2026",message_time:"10:40"}
  ]);
  assert.equal(entries.length,1);
  assert.equal(entries[0].message_id,"A5BC0F8C1493682949D17332107ACAA3");
  assert.equal(entries[0].duration_seconds,12);
  assert.equal(entries[0].audioTranscribed,true);
});

test("reconstrói prefixo de mídia que continua a mensagem anterior",()=>{
  const prefix = core.continuationPrefix("[15:16, 06/07/2026] Leticia Bougo: ","15:17","");
  assert.equal(prefix,"[15:17, 06/07/2026] Leticia Bougo: ");
});

test("a extensão captura todo o histórico carregado sem esperar indefinidamente pelo celular",async()=>{
  const content = await readFile(new URL("whatsapp-crm-extension/content-whatsapp.js", root),"utf8");
  const background = await readFile(new URL("whatsapp-crm-extension/background.js", root),"utf8");
  const contentCrm = await readFile(new URL("whatsapp-crm-extension/content-crm.js", root),"utf8");
  const manifest = JSON.parse(await readFile(new URL("whatsapp-crm-extension/manifest.json", root),"utf8"));
  const crm = await readFile(new URL("index.html", root),"utf8");
  assert.match(content,/data-testid=\"msg-container\"/);
  assert.match(content,/conversation-panel-messages/);
  assert.match(content,/olderHistoryPending/);
  assert.match(content,/if\(atTop && stableTopPasses >= 2\)/);
  assert.doesNotMatch(content,/limited:history\.limited \|\| olderHistory\.pending/);
  assert.match(crm,/result\?\.reachedStart\|\|result\?\.loadedHistoryComplete/);
  assert.match(crm,/function analyzeSavedWhatsAppConversation/);
  assert.match(content,/loadedHistoryComplete:history\.reachedStart && history\.loadedStartReached/);
  assert.match(content,/span\.selectable-text/);
  assert.doesNotMatch(content,/img\[src\^=\"data:image\"\]/);
  assert.match(crm,new RegExp(`WHATSAPP_EXTENSION_VERSION = "${manifest.version.replace(/\./g,"\\.")}"`));
  assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
  assert.match(content,/VOICE_MESSAGE_SELECTOR/);
  assert.match(content,/\[data-testid\*="ptt" i\]/);
  assert.match(content,/function ownMessageContainer/);
  assert.match(content,/signal\.closest\?\.\('\[data-testid="msg-container"\]'\)===container/);
  assert.match(content,/\[data-testid\^="conv-msg-"\],\[data-id\]/);
  assert.match(content,/const voiceRoots=\[\.\.\.main\.querySelectorAll\(VOICE_MESSAGE_SELECTOR\)\]/);
  assert.match(content,/function canonicalMessageRoot/);
  assert.match(content,/const selectedMessages=new Map\(\)/);
  assert.match(content,/function messageScrollContainers/);
  assert.match(content,/function scrollHistoryOlder/);
  assert.match(content,/function messageViewportMoved/);
  assert.match(content,/contentMoved/);
  assert.match(content,/new WheelEvent\("wheel"/);
  assert.match(content,/traversalDiagnostics/);
  assert.doesNotMatch(content,/const selectedVoices=new Map/);
  assert.match(content,/for\(let attempt=0;attempt<30&&!search;attempt\+=1\)/);
  assert.match(content,/filter\(row=>row\.querySelector\('\[data-testid="cell-frame-container"\],\[role="gridcell"\]'\)\)/);
  assert(!manifest.permissions.includes("downloads"));
  assert(!manifest.permissions.includes("debugger"));
  assert.doesNotMatch(background,/"criare-(?:start-audio-download-watch|wait-audio-download|dispatch-real-mouse-move)"/);
  assert(crm.includes("https://web.whatsapp.com/send/?phone=${number}"));
  assert(!crm.includes("whatsapp://"));
  assert.match(crm,/id="btnCaptureOpenWhatsApp"[^>]*>Capturar conversa aberta/);
  assert.match(background,/criare-capture-open-whatsapp/);
  assert.match(background,/captureMode:"opened"/);
  assert.match(content,/identity_confirmation_required/);
  assert.match(crm,/identityOverrideConfirmed:true/);
  assert.match(crm,/removeKnownWhatsAppSystemMessages/);
  assert.match(content,/short_non_scrollable_history_complete/);
  assert.match(background,/criare-audio-transcription-complete/);
  assert.match(contentCrm,/criare-whatsapp-open-capture/);
  assert.match(crm,/id="btnWhatsAppBatch"[^>]*>Atualizar conversas do WhatsApp/);
  assert.match(crm,/id="btnWhatsAppBatchTest"[^>]*>Testar atualização em 3 leads/);
  assert.match(crm,/id="whatsappBatchPanel"/);
  assert.match(crm,/runWhatsAppBatchPreflight/);
  assert.match(crm,/fjenkw jkenfjkenk/);
  assert.match(crm,/Ignorado — telefone inválido ou sem DDD/);
  assert.match(crm,/crm_whatsapp_full_batch_unlocked/);
  assert.match(crm,/saveWhatsAppBatchApproval/);
  assert.match(crm,/Iniciando atualização…/);
  assert.match(crm,/Executando pré-verificação/);
  assert.match(crm,/function isEmptyWhatsAppConversation/);
  assert.match(crm,/Sem conversa encontrada/);
  assert.match(crm,/Sem conversa: \$\{state\.stats\.noConversation\}/);
  assert.match(crm,/WHATSAPP_BATCH_AUDIO_ENABLED = false/);
  assert.match(crm,/openAndCaptureLeadConversation/);
  assert.match(crm,/writeWhatsAppCapturePatch/);
  assert.match(crm,/PGRST002/);
  assert.match(background,/criare-preflight-whatsapp/);
  assert.match(contentCrm,/criare-whatsapp-preflight/);
  assert.match(content,/criare-whatsapp-readiness/);
  assert.match(content,/const connectedWithoutChat = ready && !qrCodeDetected && conversationListDetected;/);
  assert.match(content,/criare-open-conversation-fallback/);
  assert.match(content,/function audioEntryId/);
  assert.match(content,/criare-recover-audios/);
  assert.match(content,/function audioDurationText/);
  assert.match(content,/while\(ancestor&&ancestor!==node\)/);
  assert.match(content,/text!==messageTime/);
  assert.match(content,/const messageTime=visibleTime\(node\)/);
  assert.match(content,/const durationLeaves=\[\]/);
  assert.match(content,/durationLeaves\.sort/);
  assert.match(content,/playerDurationSeconds\(durationText\)/);
  assert.match(content,/duration_source:playerDuration\?"whatsapp_player"/);
  assert.match(content,/normalizeWhatsAppMessageId/);
  assert.match(content,/targetMessageId\(item\)===domMessageId/);
  assert.doesNotMatch(content,/queueMicrotask\(\(\)=>processAudioQueue/);
  assert.match(crm,/normalizeWhatsAppMessageId\(item\.entry\.message_id\|\|item\.entry\.id\)===recoveredMessageId/);
  assert.doesNotMatch(crm,/const structural=slots\.filter/);
  assert.match(crm,/select\("\*"\)\.eq\("id",record\.id\)\.single\(\)/);
  assert.match(crm,/Nenhuma duração foi lida pelo WhatsApp; a associação manual do único áudio permanece disponível/);
  assert.match(crm,/function canonicalAudioEntries/);
  assert.match(crm,/entries=canonicalAudioEntries\(record\.whatsapp_message_entries\)/);
  assert.match(crm,/id="btnRefreshAudioMetadata"[^>]*>Atualizar metadados dos áudios/);
  assert.match(crm,/CriareWhatsAppCaptureCore\.mergeEntryMetadata/);
  assert.match(crm,/requestWhatsAppAudioRecovery\(record,\{metadataOnly:true\}\)/);
  assert.match(crm,/leadId:record\.id,workspaceId:phoneWorkspaceKey\(record\),phone/);
  assert.match(crm,/function updateCompletenessAudioMetadata\(record,button\)/);
  assert.match(crm,/if\(action==="metadata"\)return updateCompletenessAudioMetadata\(record,button\)/);
  assert.doesNotMatch(crm,/if\(action==="metadata"\)\{openModal\(record\)/);
  assert.match(crm,/Atualização de metadados: \$\{stage\}/);
  assert.match(crm,/CriareAudioImportMatcher\.validateManualAssignments/);
  assert.match(crm,/association_status:"manual_confirmed"/);
  assert.match(crm,/const durationSource=playerConfirmed\?"whatsapp_player":"manual_confirmed"/);
  assert.doesNotMatch(crm,/importedAudioEntries/);
  assert.match(content,/nao_localizado_no_dom/);
  assert.match(crm,/audioImportModal/);
  assert.match(crm,/Importar áudios baixados/);
  assert.match(crm,/id="audioImportDirectionMode"/);
  assert.match(crm,/CriareAudioImportMatcher\.matchFiles/);
  assert.match(crm,/LOCAL_AUDIO_TRANSCRIBER_HEALTH_URL/);
  assert.match(crm,/function normalizeImportedTranscript/);
  assert.match(crm,/transcription_status:"transcribed"/);
  assert.match(crm,/whatsapp_analysis_status:"stale"/);
  assert.match(crm,/LOCAL_AUDIO_TRANSCRIBER_URL/);
  assert.match(background,/criare-open-conversation-fallback/);
  assert.match(background,/criare-confirm-conversation-phone/);
  assert.match(content,/phoneIdentityConfirmed/);
  assert.doesNotMatch(content,/phoneNavigationConfirmed===true/);
  assert.match(content,/waitForHistoryHydration/);
  assert.match(content,/domMessagesFound/);
  assert.match(crm,/captureCompletenessConversation\(record,button\)/);
  assert.match(crm,/reread_succeeded:true/);
  assert.match(background,/criare-recover-whatsapp-audios/);
  assert.match(contentCrm,/criare-whatsapp-recover-audios/);
  assert.match(background,/timeoutMs:14000/);
  assert.match(crm,/whatsappAnalysisIsStale/);
  assert.match(content,/matches:sameCustomer\(title, request\)/);
  assert.doesNotMatch(content,/trustedTarget\) \|\| sameCustomer/);
});

test("a análise não trunca silenciosamente conversas longas",async()=>{
  const summary = await readFile(new URL("supabase/functions/whatsapp-summary/index.ts", root),"utf8");
  assert.match(summary,/rawConversation\.length > 300000/);
  assert.match(summary,/CONVERSATION_TOO_LONG/);
  assert.match(summary,/clean\(rawConversation, 300000\)/);
});

test("a análise depende do GPT e mantém a conversa para nova tentativa",async()=>{
  const crm = await readFile(new URL("index.html", root),"utf8");
  const summary = await readFile(new URL("supabase/functions/whatsapp-summary/index.ts", root),"utf8");
  assert.match(crm,/const result = await callWhatsAppSummary\(conversation\);\s*await saveWhatsAppAnalysisResult\(result\);/);
  assert.doesNotMatch(crm,/localWhatsAppSummary/);
  assert.match(crm,/whatsappCapturedConversation/);
  assert.match(summary,/conversa permanece salva e pronta para nova tentativa/);
});

test("o quadro horizontal aceita arraste somente em área não interativa",async()=>{
  const crm = await readFile(new URL("index.html", root),"utf8");
  assert.match(crm,/data-horizontal-drag/);
  assert.match(crm,/function enableHorizontalDragScroll/);
  assert.match(crm,/\.card,button,a,input,select,textarea/);
  assert.match(crm,/pointerdown/);
});

test("normaliza registros antigos sem substituir a análise existente",async()=>{
  const crm = await readFile(new URL("index.html", root),"utf8");
  assert.match(crm,/function normalizeLegacyWhatsAppRecord/);
  assert.match(crm,/legacyTranscriptEntries\(record\)/);
  assert.match(crm,/record\.whatsapp_analysis_hard_boss\|\|record\.whatsapp_summary/);
  assert.match(crm,/persistLegacyWhatsAppNormalization/);
  assert.match(crm,/if\(!original\.whatsapp_analysis_hard_boss&&normalized\.whatsapp_analysis_hard_boss\)/);
});

test("o painel do lead mantém seções fechadas e o Chefe Duro visível",async()=>{
  const crm = await readFile(new URL("index.html", root),"utf8");
  assert.match(crm,/id="appointmentSection"/);
  assert.match(crm,/id="leadInfoSection"/);
  assert.match(crm,/id="whatsappSection"/);
  assert.match(crm,/Chefe Duro — Próxima condução/);
  assert.match(crm,/setLeadSectionOpen\("appointmentSection",false\)/);
  assert.match(crm,/Análise ainda não executada\./);
});

test("ponte do CRM trata contexto invalidado e evita listeners duplicados",async()=>{
  const bridge=await readFile(new URL("../whatsapp-crm-extension/content-crm.js",import.meta.url),"utf8");
  assert.match(bridge,/__criareWhatsAppCrmBridgeRegistered/);assert.match(bridge,/sendRuntimeMessage/);assert.match(bridge,/extension_context_invalidated/);assert.match(bridge,/reconnectRequired/);assert.match(bridge,/try\{/);assert.doesNotMatch(bridge,/chrome\.runtime\.sendMessage\([^\n]+,[^\n]+=>/);
});

test("central usa E.164 canônico, busca local e painel persistente",async()=>{
  const crm=await readFile(new URL("../index.html",import.meta.url),"utf8");assert.match(crm,/normalized\?\.normalized_e164/);assert.doesNotMatch(crm,/escapeHtml\(identity\.normalized\|\|/);assert.match(crm,/Buscar cliente ou telefone/);assert.match(crm,/matchesSearch/);assert.match(crm,/Completude da conversa/);assert.match(crm,/conversationCompletenessPanel[^]*leadSectionBody/);
});

test("preflight oferece reconexão, lista estruturada e não duplica mensagem final",async()=>{
  const crm=await readFile(new URL("../index.html",import.meta.url),"utf8");assert.match(crm,/btnReconnectExtension/);assert.match(crm,/batchPreflightHtml/);assert.match(crm,/Pré-verificação concluída\./);assert.doesNotMatch(crm,/updateWhatsAppBatchPanel\(batchPreflightLabel\(result\)\)/);
});

test("confirma conversa somente pelo telefone E.164 navegado",async()=>{
  const content=await readFile(new URL("../whatsapp-crm-extension/content-whatsapp.js",import.meta.url),"utf8");
  const background=await readFile(new URL("../whatsapp-crm-extension/background.js",import.meta.url),"utf8");
  assert.doesNotMatch(content,/expectedName|nameMatches/);
  assert.match(content,/phoneIdentityConfirmed===true/);
  assert.match(content,/comparableDigits\(request\?\.confirmedPhone\)===expectedDigits/);
  assert.match(background,/criare-confirm-conversation-phone/);
  assert.match(background,/captureChatFromTab\(opened\.tabId,\{\.\.\.request,phone,request_id:operationId,phoneIdentityConfirmed:true/);
});

test("fallback reconhece o campo de busca atual da lista lateral",async()=>{
  const content=await readFile(new URL("../whatsapp-crm-extension/content-whatsapp.js",import.meta.url),"utf8");
  assert.match(content,/aria-placeholder\*="Pesquisar"/);
  assert.match(content,/aria-label\*="Pesquisar"/);
  assert.match(content,/data-tab="3"/);
});

test("matcher decide o ajuste de calendário por arquivo e não invalida datas já corretas",()=>{
  const inventory=matcher.buildInventory([
    {message_id:"CRISTINA-1551",type:"Áudio",sender:"Você",direction:"outgoing",date:"30/06/2026",time:"15:51",duration_seconds:27,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:0},
    {message_id:"CRISTINA-1635",type:"Áudio",sender:"Você",direction:"outgoing",date:"30/06/2026",time:"16:35",duration_seconds:84,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:1},
    {message_id:"CRISTINA-0857",type:"Áudio",sender:"Você",direction:"outgoing",date:"30/06/2026",time:"08:57",duration_seconds:44,duration_source:"whatsapp_player",text:"[Áudio sem transcrição]",chronological_position:2}
  ]);
  const matching=matcher.matchFiles([
    {name:"WhatsApp Ptt 2026-06-30 at 15.51.43.ogg",duration:27,import_order:0},
    {name:"WhatsApp Ptt 2026-06-30 at 16.35.27.ogg",duration:85,import_order:1},
    {name:"WhatsApp Ptt 2026-07-01 at 08.57.11.ogg",duration:44,import_order:2}
  ],inventory,{directionMode:"both",calendarDateShiftMs:-24*60*60*1000});
  assert.deepEqual(matching.assignments.map(item=>item.message_id),["CRISTINA-1551","CRISTINA-1635","CRISTINA-0857"]);
  assert(!matching.results[0].assigned.reasons.includes("data ajustada por diferença de calendário confirmada"));
  assert(!matching.results[1].assigned.reasons.includes("data ajustada por diferença de calendário confirmada"));
  assert(matching.results[2].assigned.reasons.includes("data ajustada por diferença de calendário confirmada"));
});
