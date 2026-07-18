import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

await import("../batch-analysis.js");
const batch=globalThis.CriareBatchAnalysis;

const textLead={id:"lead-text",first_name:"Nathalia",last_name:"Oliveira",phone:"19996142935",pipeline:"lead",stage:"Recepção e sondagem",source:"WhatsApp",notes:"Cliente quer cozinha.",whatsapp_analysis_status:"never",whatsapp_message_entries:[
  {message_id:"wa:TXT1",timestamp:"2026-03-04T10:00:00-03:00",sender:"Nathalia",direction:"incoming",type:"Texto",text:"Bom dia"},
  {message_id:"wa:TXT2",timestamp:"2026-03-04T10:02:00-03:00",sender:"Você",direction:"outgoing",type:"Texto",text:"Como posso ajudar?"}
]};
const audioLead={id:"lead-audio",first_name:"Crislaine",pipeline:"lead",stage:"Qualificação",notes:"Evento RD: {raw:true}",whatsapp_analysis_status:"stale",whatsapp_message_entries:[
  {message_id:"AUD1",timestamp:"2026-03-04T10:26:00-03:00",sender:"Crislaine",direction:"incoming",type:"Áudio",text:"[Áudio sem transcrição]",transcript:"Quero um orçamento para o quarto",audioMeta:{dom_selector:"não exportar",blob_url:"blob:segredo"}},
  {message_id:"AUD2",timestamp:"2026-03-04T10:27:00-03:00",sender:"Você",direction:"outgoing",type:"Áudio",text:"[Áudio sem transcrição]",temporary_file:"/tmp/audio.ogg"}
]};
const staleLead={...textLead,id:"lead-stale",first_name:"Melissa",whatsapp_analysis_status:"stale"};

function validAnalysis(leadId,hash,lastId){return {lead_id:leadId,conversation_hash:hash,analyzed_until_message_id:lastId,chefe_duro:"Retome o contato hoje.",executive_summary:"Lead qualificado aguardando retorno.",full_analysis:"A conversa mostra interesse e uma pergunta sem resposta.",lead_profile:{fit:"high",purchase_intent:"medium",decision_stage:"consideration",budget_signal:"unknown"},service_quality:{seller_score:80,timing_score:70,discovery_score:65,follow_up_score:60,conduct_score:90},conversation_status:{waiting_for:"seller",waiting_since:null,customer_questions_unanswered:["Qual é o prazo?"],seller_commitments_overdue:[]},risk:{level:"high",urgency_score:82,reasons:["Cliente aguardando"]},opportunities:["Agendar briefing"],failures:["Prazo não respondido"],recommended_next_actions:[{priority:"high",action:"Responder e agendar briefing",owner:"seller",due_in_hours:4,suggested_message:"Podemos conversar hoje?"}],tags:["quente"]};}
async function envelopeFor(record){const hash=await batch.conversationHash(record);return {schema_version:"1.0",generated_at:"2026-07-17T12:00:00.000Z",analysis_model:"Custom GPT",prompt_version:"criare-batch-v1",analyses:[validAnalysis(record.id,hash,batch.lastMessageId(record))]};}

test("conversation_hash é determinístico e muda com alteração material",async()=>{
  assert.equal(await batch.conversationHash(textLead),await batch.conversationHash(structuredClone(textLead)));
  const changed=structuredClone(textLead);changed.whatsapp_message_entries[1].text="Novo texto";
  assert.notEqual(await batch.conversationHash(textLead),await batch.conversationHash(changed));
});

test("separa data, horário, remetente, direção e corpo das mensagens legadas",()=>{
  const record={whatsapp_message_entries:[{message_id:"legacy-1",text:"[14:21, 10/07/2026] Criare Ambientes Planejados: Boa tarde"},{message_id:"legacy-2",text:"[14:32, 10/07/2026] Melissa Stefany: Quero a cozinha"}]};
  const messages=batch.canonicalMessages(record);
  assert.deepEqual(messages.map(message=>({timestamp:message.timestamp,sender:message.sender,direction:message.direction,text:message.text})),[
    {timestamp:"2026-07-10T14:21:00-03:00",sender:"Criare Ambientes Planejados",direction:"outgoing",text:"Boa tarde"},
    {timestamp:"2026-07-10T14:32:00-03:00",sender:"Melissa Stefany",direction:"incoming",text:"Quero a cozinha"}
  ]);
});

test("usa o último horário real disponível sem substituir por horário técnico da captura",async()=>{
  const record={whatsapp_transcript_updated_at:"2026-07-18T00:00:00Z",whatsapp_message_entries:[{message_id:"1",text:"[10:26, 04/03/2026] Cliente: texto"},{message_id:"2",type:"Áudio",text:"[Áudio sem transcrição]"}]};
  assert.equal(batch.lastMessageTimestamp(record),"2026-03-04T10:26:00-03:00");
  assert.equal((await batch.exportLead(record,{})).last_whatsapp_message_timestamp,"2026-03-04T10:26:00-03:00");
});

test("mantém timestamp nulo quando a data da mensagem não foi identificada",()=>{
  const messages=batch.canonicalMessages({whatsapp_message_entries:[{message_id:"audio-sem-data",date:"data não identificada",time:"10:30",type:"Áudio",text:"[Áudio sem transcrição]"}]});
  assert.equal(messages[0].timestamp,null);
});

test("exporta texto e áudio transcrito no formato canônico",async()=>{
  const exported=await batch.exportLead(audioLead,{full_name:"Crislaine",seller:"Marianna",commitments:[]});
  assert.equal(exported.messages[0].audio_transcription,"Quero um orçamento para o quarto");
  assert.equal(exported.messages[0].text,"[Transcrição de áudio] Quero um orçamento para o quarto");
  assert.equal(exported.messages[0].direction,"incoming");
});

test("marca explicitamente áudio sem transcrição",()=>{
  const messages=batch.canonicalMessages(audioLead);
  assert.equal(messages[1].text,"[Áudio sem transcrição]");
  assert.equal(messages[1].audio_status,"not_transcribed");
});

test("não exporta diagnósticos, DOM, blobs, temporários ou RD bruto isolado",async()=>{
  const exported=await batch.exportLead(audioLead,{});const serialized=JSON.stringify(exported);
  assert.equal(exported.crm_observations,null);
  for(const forbidden of ["dom_selector","blob_url","temporary_file","raw:true"])assert.equal(serialized.includes(forbidden),false);
});

test("aceita importação JSON válida",async()=>{
  const payload=await envelopeFor(textLead);const result=await batch.validateImport(payload,[textLead]);
  assert.equal(result.validEnvelope,true);assert.equal(result.results[0].status,"ready_to_import");
});

test("rejeita conversation_hash desatualizado",async()=>{
  const payload=await envelopeFor(textLead);payload.analyses[0].conversation_hash="hash-antigo";
  const result=await batch.validateImport(payload,[textLead]);assert.equal(result.results[0].status,"stale_conversation");
});

test("mantém uma análise primária e rejeita a repetição exata",async()=>{
  const payload=await envelopeFor(textLead);payload.analyses.push(structuredClone(payload.analyses[0]));
  const result=await batch.validateImport(payload,[textLead]);assert.deepEqual(result.results.map(item=>item.status),["ready_to_import","duplicate"]);
});

test("rejeita enum inválido",async()=>{
  const payload=await envelopeFor(textLead);payload.analyses[0].risk.level="gigante";
  const result=await batch.validateImport(payload,[textLead]);assert.equal(result.results[0].status,"invalid_analysis");
});

test("rejeita pontuação fora de 0–100",async()=>{
  const payload=await envelopeFor(textLead);payload.analyses[0].service_quality.seller_score=101;
  const result=await batch.validateImport(payload,[textLead]);assert.equal(result.results[0].status,"invalid_analysis");
});

test("lote parcial mantém válidos mesmo quando outro lead falha",async()=>{
  const first=await envelopeFor(textLead),second=await envelopeFor(staleLead);second.analyses[0].conversation_hash="antigo";
  const payload={...first,analyses:[first.analyses[0],second.analyses[0]]};
  const result=await batch.validateImport(payload,[textLead,staleLead]);
  assert.deepEqual(result.results.map(item=>item.status),["ready_to_import","stale_conversation"]);
});

test("persistência mantém análise anterior no histórico e não altera conversa",async()=>{
  const prior={...textLead,whatsapp_analysis_hard_boss:"Veredito anterior",whatsapp_analysis_full:"Análise anterior",whatsapp_analysis_structured:{old:true},whatsapp_analysis_updated_at:"2026-07-01T00:00:00Z",whatsapp_analysis_history:[]};
  const payload=await envelopeFor(prior),patch=batch.persistencePatch(prior,payload.analyses[0],payload,"2026-07-17T12:10:00Z");
  assert.equal(patch.whatsapp_analysis_history.length,1);assert.equal(patch.whatsapp_analysis_history[0].hard_boss,"Veredito anterior");
  assert.equal("whatsapp_message_entries" in patch,false);
  const crm=await readFile(new URL("../index.html",import.meta.url),"utf8");assert.match(crm,/whatsapp_analysis_status:"stale"/);
});

test("releitura após importação reconhece o mesmo hash como já importado",async()=>{
  const payload=await envelopeFor(textLead),patch=batch.persistencePatch(textLead,payload.analyses[0],payload,"2026-07-17T12:10:00Z");
  const reloaded={...textLead,...structuredClone(patch)};const result=await batch.validateImport(payload,[reloaded]);
  assert.equal(reloaded.whatsapp_analysis_structured.batch_metadata.conversation_hash,payload.analyses[0].conversation_hash);
  assert.equal(result.results[0].status,"already_imported");
});

test("três fixtures geram pacote ZIP com os quatro arquivos obrigatórios",async()=>{
  const payload=await batch.buildBatch([textLead,audioLead,staleLead]);assert.equal(payload.conversation_count,3);
  const files=batch.packageFiles(payload);assert.deepEqual(Object.keys(files),["batch_input.json","analysis_instructions.md","analysis_output_schema.json","README.txt"]);
  const zip=batch.zipFiles(files);assert(zip.length>JSON.stringify(payload).length);assert.equal(new DataView(zip.buffer).getUint32(0,true),0x04034b50);
});

test("nome do pacote exportado começa com 01-ENVIAR-AO-GPT",async()=>{
  const payload=await batch.buildBatch([textLead]);assert.match(batch.inputFilename(payload.batch_id),/^01-ENVIAR-AO-GPT_criare-lote_\d{8}-\d{4}-[A-F0-9]{4}\.zip$/);
});

test("nome esperado do resultado começa com 02-IMPORTAR-NO-CRM",async()=>{
  const payload=await batch.buildBatch([textLead]);assert.equal(payload.expected_output_filename,batch.outputFilename(payload.batch_id));assert.match(payload.expected_output_filename,/^02-IMPORTAR-NO-CRM_criare-analises_/);
});

test("batch_id está presente em todos os componentes do pacote",async()=>{
  const payload=await batch.buildBatch([textLead]),files=batch.packageFiles(payload);assert.equal(JSON.parse(files["batch_input.json"]).batch_id,payload.batch_id);assert.equal(JSON.parse(files["analysis_output_schema.json"]).batch_id,payload.batch_id);assert.match(files["analysis_instructions.md"],new RegExp(payload.batch_id));assert.match(files["README.txt"],new RegExp(payload.batch_id));
});

test("JSON de entrada selecionado no importador é classificado e rejeitado claramente",async()=>{
  const payload=await batch.buildBatch([textLead]),classification=batch.classifyImportPayload(payload,{filename:"batch_input.json",type:"application/json"});assert.equal(classification.code,"input_payload");assert.equal(classification.label,"Pacote de entrada enviado ao GPT");
});

test("ZIP de entrada selecionado no importador é classificado e rejeitado claramente",()=>{
  const classification=batch.classifyImportPayload(null,{filename:"01-ENVIAR-AO-GPT_criare-lote_20260718-0745-A7F3.zip",type:"application/zip"});assert.equal(classification.code,"input_package");
});

test("resultado 1.1 válido é reconhecido pelo conteúdo",async()=>{
  const input=await batch.buildBatch([textLead]),item=validAnalysis(textLead.id,input.conversations[0].conversation_hash,batch.lastMessageId(textLead));item.batch_id=input.batch_id;const payload={schema_version:"1.1",batch_id:input.batch_id,generated_at:"2026-07-18T12:00:00Z",analysis_model:"Custom GPT",prompt_version:"criare-batch-v1",analyses:[item]};const classification=batch.classifyImportPayload(payload,{filename:input.expected_output_filename,type:"application/json"});assert.equal(classification.code,"analysis_result");assert.equal((await batch.validateImport(payload,[textLead])).results[0].status,"ready_to_import");
});

test("nome correto não contorna a validação do conteúdo",async()=>{
  const input=await batch.buildBatch([textLead]),classification=batch.classifyImportPayload(input,{filename:input.expected_output_filename,type:"application/json"});assert.equal(classification.code,"input_payload");
});

test("lotes misturados no schema 1.1 são rejeitados",async()=>{
  const input=await batch.buildBatch([textLead,audioLead]),analyses=[];for(const conversation of input.conversations){const record=conversation.lead_id===textLead.id?textLead:audioLead,item=validAnalysis(record.id,conversation.conversation_hash,batch.lastMessageId(record));item.batch_id=input.batch_id;analyses.push(item);}analyses[1].batch_id="20260718-0745-FFFF";const payload={schema_version:"1.1",batch_id:input.batch_id,generated_at:"2026-07-18T12:00:00Z",analysis_model:"Custom GPT",prompt_version:"criare-batch-v1",analyses};assert.equal(batch.classifyImportPayload(payload,{filename:input.expected_output_filename}).code,"incompatible");const validation=await batch.validateImport(payload,[textLead,audioLead]);assert.equal(validation.validEnvelope,false);assert(validation.results.every(item=>item.status==="invalid_schema"));
});

test("schema 1.0 permanece compatível",async()=>{
  const payload=await envelopeFor(textLead),classification=batch.classifyImportPayload(payload,{filename:"resultado-legado.json",type:"application/json"});assert.equal(classification.code,"analysis_result");assert.equal((await batch.validateImport(payload,[textLead])).results[0].status,"ready_to_import");
});

async function threeAnalysisEnvelope(records=[textLead,audioLead,staleLead]){const analyses=[];for(const record of records)analyses.push(validAnalysis(record.id,await batch.conversationHash(record),batch.lastMessageId(record)));return {schema_version:"1.0",generated_at:"2026-07-18T02:02:29.657Z",analysis_model:"GPT de teste",prompt_version:"criare-batch-v1",analyses};}
async function sixAnalysisEnvelope(){const payload=await threeAnalysisEnvelope();return {...payload,analyses:payload.analyses.flatMap(item=>[structuredClone(item),structuredClone(item)])};}
async function simulateImport(payload,database,machine=batch.createImportStateMachine()){
  const records=[...database.values()];const validation=await batch.validateImport(payload,records);machine.load(payload,validation);let writes=0;
  if(machine.phase==="completed")return {writes,validation,machine,blocked:true};
  const result=await machine.run(async snapshot=>{const queue=[...new Map(snapshot.validation.results.filter(item=>item.status==="ready_to_import").map(item=>[item.import_key,item])).values()];for(const item of queue){const fresh=database.get(item.lead_id);if(batch.storedImportKeys(fresh).has(item.import_key)){item.status="already_imported";continue;}const patch=batch.persistencePatch(fresh,item.item,payload,"2026-07-18T03:00:00Z");const reloaded={...fresh,...structuredClone(patch)};database.set(item.lead_id,reloaded);writes+=1;item.status="imported";}return {writes,validation};});return {...result,machine};
}

test("três análises únicas produzem três itens de prévia",async()=>{
  const result=await batch.validateImport(await threeAnalysisEnvelope(),[textLead,audioLead,staleLead]);assert.equal(result.results.length,3);assert.equal(result.results.filter(item=>item.status==="ready_to_import").length,3);assert.equal(result.summary.unique,3);
});

test("fixture real de seis entradas representa três chaves e três duplicatas",async()=>{
  const result=await batch.validateImport(await sixAnalysisEnvelope(),[textLead,audioLead,staleLead]);assert.equal(result.summary.received,6);assert.equal(result.summary.unique,3);assert.equal(result.summary.duplicates,3);assert.equal(result.results.filter(item=>item.status==="ready_to_import").length,3);
});

test("seis entradas duplicadas produzem somente três gravações",async()=>{
  const database=new Map([textLead,audioLead,staleLead].map(record=>[record.id,structuredClone(record)]));const result=await simulateImport(await sixAnalysisEnvelope(),database);assert.equal(result.writes,3);assert.equal(database.size,3);
});

test("segunda importação do mesmo JSON produz zero gravações e três already_imported",async()=>{
  const database=new Map([textLead,audioLead,staleLead].map(record=>[record.id,structuredClone(record)])),payload=await sixAnalysisEnvelope();const first=await simulateImport(payload,database);const second=await simulateImport(payload,database,first.machine);assert.equal(first.writes,3);assert.equal(second.writes,0);assert.equal(second.validation.results.filter(item=>item.status==="already_imported").length,3);assert.equal(second.validation.results.filter(item=>item.status==="duplicate").length,3);
});

test("duplo clique compartilha uma única execução",async()=>{
  const machine=batch.createImportStateMachine();machine.load({}, {results:[{status:"ready_to_import"}]});let calls=0;const task=async()=>{calls+=1;await new Promise(resolve=>setTimeout(resolve,5));return {ok:true};};const [one,two]=await Promise.all([machine.run(task),machine.run(task)]);assert.equal(calls,1);assert.deepEqual(one,two);assert.equal(machine.phase,"completed");
});

test("duas chamadas simultâneas fazem uma gravação por lead",async()=>{
  const machine=batch.createImportStateMachine();machine.load({}, {results:[{status:"ready_to_import"}]});let writes=0;const task=async()=>{writes+=1;await new Promise(resolve=>setTimeout(resolve,5));return writes;};await Promise.all([machine.run(task),machine.run(task)]);assert.equal(writes,1);
});

test("listeners de importação têm guarda global e um único registro",async()=>{
  const ui=await readFile(new URL("../batch-analysis-ui.js",import.meta.url),"utf8");assert.match(ui,/__criareBatchAnalysisUiLoaded/);assert.match(ui,/__criareBatchAnalysisStaticListenersRegistered/);assert.equal((ui.match(/btnImportValidatedBatch"\)\.addEventListener\("click",importValidated/g)||[]).length,1);assert.match(ui,/dataset\.batchWired/);
});

test("validar duas vezes substitui o snapshot em vez de anexar",()=>{
  const machine=batch.createImportStateMachine();machine.load({id:1},{results:[{status:"ready_to_import"},{status:"duplicate"}]});machine.load({id:2},{results:[{status:"ready_to_import"}]});assert.equal(machine.snapshot.payload.id,2);assert.equal(machine.snapshot.validation.results.length,1);assert.equal(machine.generation,2);
});

test("análise atual com a mesma chave torna-se already_imported",async()=>{
  const payload=await envelopeFor(textLead),patch=batch.persistencePatch(textLead,payload.analyses[0],payload);const current={...textLead,...patch};const result=await batch.validateImport(payload,[current]);assert.equal(result.results[0].status,"already_imported");assert(batch.storedImportKeys(current).has(batch.canonicalImportKey(payload.analyses[0],payload)));
});

test("mesma chave com conteúdo diferente bloqueia ambas como duplicate_conflict",async()=>{
  const payload=await envelopeFor(textLead),conflict=structuredClone(payload.analyses[0]);conflict.chefe_duro="Conteúdo materialmente diferente";payload.analyses.push(conflict);const result=await batch.validateImport(payload,[textLead]);assert.equal(result.summary.duplicate_conflicts,2);assert(result.results.every(item=>item.status==="duplicate_conflict"));
});

test("histórico recebe a análise anterior uma única vez",async()=>{
  const priorPayload=await envelopeFor(textLead),priorPatch=batch.persistencePatch(textLead,priorPayload.analyses[0],priorPayload,"2026-07-17T00:00:00Z");const withPrior={...textLead,...priorPatch};const changedItem=structuredClone(priorPayload.analyses[0]);changedItem.conversation_hash="hash-novo";changedItem.analyzed_until_message_id="novo-id";const changedEnvelope={...priorPayload,analyses:[changedItem]};const first=batch.persistencePatch(withPrior,changedItem,changedEnvelope,"2026-07-18T00:00:00Z");const afterFirst={...withPrior,...first};const second=batch.persistencePatch(afterFirst,changedItem,changedEnvelope,"2026-07-18T00:01:00Z");assert.equal(first.whatsapp_analysis_history.length,1);assert.equal(second.whatsapp_analysis_history.length,1);
});

test("releitura simulada mantém um resultado verificado por lead",async()=>{
  const database=new Map([textLead,audioLead,staleLead].map(record=>[record.id,structuredClone(record)])),payload=await threeAnalysisEnvelope();const result=await simulateImport(payload,database);assert.equal(result.writes,3);for(const item of payload.analyses){const stored=database.get(item.lead_id);assert.equal(stored.whatsapp_analysis_structured.batch_metadata.import_key,batch.canonicalImportKey(item,payload));}assert.equal(new Set([...database.values()].map(record=>record.whatsapp_analysis_structured.batch_metadata.import_key)).size,3);
});
