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
assert.equal(matcher.version,"2.2.1");

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

test("atualiza mensagem editada sem duplicar o ID",()=>{
  const merged = core.mergeEntries(
    [{id:"wa:1",text:"[10:00, 01/07/2026] Cliente: segunda"}],
    [{id:"wa:1",text:"[10:00, 01/07/2026] Cliente: terça"}]
  );
  assert.equal(merged.entries.length,1);
  assert.equal(merged.updatedCount,1);
  assert.match(merged.entries[0].text,/terça/);
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
  assert.match(crm,/WHATSAPP_EXTENSION_VERSION = "2\.3\.6"/);
  assert.equal(manifest.version,"2.3.6");
  assert.match(content,/for\(let attempt=0;attempt<30&&!search;attempt\+=1\)/);
  assert(!manifest.permissions.includes("downloads"));
  assert(!manifest.permissions.includes("debugger"));
  assert.doesNotMatch(background,/"criare-(?:start-audio-download-watch|wait-audio-download|dispatch-real-mouse-move)"/);
  assert(crm.includes("https://web.whatsapp.com/send/?phone=${number}"));
  assert(!crm.includes("whatsapp://"));
  assert.match(crm,/id="btnCaptureOpenWhatsApp"[^>]*>Capturar conversa aberta/);
  assert.match(background,/criare-capture-open-whatsapp/);
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
  assert.match(content,/text!==visibleTime\(node\)/);
  assert.match(content,/playerDurationSeconds\(durationText\)/);
  assert.match(content,/duration_source:playerDuration\?"whatsapp_player"/);
  assert.match(content,/normalizeWhatsAppMessageId/);
  assert.match(content,/targetMessageId\(item\)===domMessageId/);
  assert.doesNotMatch(content,/queueMicrotask\(\(\)=>processAudioQueue/);
  assert.match(crm,/normalizeWhatsAppMessageId\(item\.entry\.message_id\|\|item\.entry\.id\)===recoveredMessageId/);
  assert.doesNotMatch(crm,/const structural=slots\.filter/);
  assert.match(crm,/select\("\*"\)\.eq\("id",record\.id\)\.single\(\)/);
  assert.match(crm,/O WhatsApp respondeu, mas não devolveu nenhuma duração válida dos players/);
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
