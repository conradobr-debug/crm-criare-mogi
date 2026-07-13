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

test("reconstrói prefixo de mídia que continua a mensagem anterior",()=>{
  const prefix = core.continuationPrefix("[15:16, 06/07/2026] Leticia Bougo: ","15:17","");
  assert.equal(prefix,"[15:17, 06/07/2026] Leticia Bougo: ");
});

test("a extensão captura todo o histórico carregado sem esperar indefinidamente pelo celular",async()=>{
  const content = await readFile(new URL("whatsapp-crm-extension/content-whatsapp.js", root),"utf8");
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
  assert.match(crm,/WHATSAPP_EXTENSION_VERSION = "2\.1\.2"/);
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
