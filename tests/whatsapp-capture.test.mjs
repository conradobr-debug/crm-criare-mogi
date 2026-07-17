import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const coreSource = await readFile(new URL("whatsapp-crm-extension/capture-core.js", root), "utf8");
const context = {globalThis:{}};
vm.runInNewContext(coreSource, context);
const core = context.globalThis.CriareWhatsAppCaptureCore;

test("preserva mensagens repetidas quando os IDs do WhatsApp são diferentes",()=>{
  const merged = core.mergeEntries([], [
    {id:"wa:1",text:"[10:00, 01/07/2026] Cliente: Obrigada"},
    {id:"wa:2",text:"[10:00, 01/07/2026] Cliente: Obrigada"}
  ]);
  assert.equal(merged.entries.length,2);
  assert.equal(merged.addedCount,2);
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

test("áudios idênticos com identidade própria não são colapsados",()=>{
  const audios=Array.from({length:8},(_,index)=>({id:`audio:crislane:${index}`,text:"[Áudio sem transcrição]",type:"Áudio",duration:12,sender:"Crislaine",chronological_position:index}));
  const first=core.mergeEntries([],audios);
  const repeated=core.mergeEntries(first.entries,audios);
  assert.equal(first.entries.length,8);
  assert.equal(repeated.entries.length,8);
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
  assert.match(content,/loadedHistoryComplete:history\.loadedStartReached/);
  assert.match(content,/span\.selectable-text/);
  assert.doesNotMatch(content,/img\[src\^=\"data:image\"\]/);
  assert.match(crm,/WHATSAPP_EXTENSION_VERSION = "2\.1\.17"/);
  assert.equal(manifest.version,"2.1.17");
  assert(!manifest.permissions.includes("downloads"));
  assert(!manifest.permissions.includes("debugger"));
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
  assert.match(content,/menu_sem_opcao_baixar/);
  assert.match(content,/function audioDurationText/);
  assert.match(content,/download_clicked/);
  assert.match(content,/nao_localizado_no_dom/);
  assert.match(content,/downloadAudioFromContextMenu/);
  assert.match(content,/revealMessageContextMenuTrigger/);
  assert.match(content,/icon-down-context/);
  assert.match(crm,/audioImportModal/);
  assert.match(crm,/Importar áudios baixados/);
  assert.match(crm,/LOCAL_AUDIO_TRANSCRIBER_URL/);
  assert.match(background,/criare-start-audio-download-watch/);
  assert.match(background,/criare-open-conversation-fallback/);
  assert.match(background,/criare-recover-whatsapp-audios/);
  assert.match(contentCrm,/criare-whatsapp-recover-audios/);
  assert.match(background,/timeoutMs:14000/);
  assert.match(content,/if\(!request\?\.disableAudio\)/);
  assert.match(crm,/whatsappAnalysisIsStale/);
  assert.match(content,/LOCAL_TRANSCRIBER_URL/);
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
