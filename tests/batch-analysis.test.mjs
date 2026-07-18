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

test("rejeita lead duplicado no mesmo lote",async()=>{
  const payload=await envelopeFor(textLead);payload.analyses.push(structuredClone(payload.analyses[0]));
  const result=await batch.validateImport(payload,[textLead]);assert(result.results.every(item=>item.status==="duplicate"));
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
