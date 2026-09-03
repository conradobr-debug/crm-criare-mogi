import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

await import("../conversation-completeness.js");
await import("../batch-analysis.js");
await import("../whatsapp-chatgpt-export.js");

const exporter=globalThis.CriareWhatsAppChatGptExport;
const completeRecord={
  id:"lead-1",first_name:"João",last_name:"D'Ávila / Teste",phone:"+55 19 99999-0000",whatsapp_external_chat_id:"5519999990000@c.us",whatsapp_capture_complete:true,
  whatsapp_summary:"NÃO EXPORTAR RESUMO",whatsapp_analysis_full:"NÃO EXPORTAR ANÁLISE",whatsapp_analysis_hard_boss:"NÃO EXPORTAR CHEFE",chefe_duro:"NÃO EXPORTAR SCORE",
  whatsapp_message_entries:[
    {message_id:"wa:m1",timestamp:"2026-08-01T10:00:00-03:00",sender:"João",direction:"incoming",type:"Texto",text:"Olá, quero preservar `este` texto."},
    {message_id:"wa:m2",timestamp:"2026-08-01T10:01:00-03:00",sender:"Você",direction:"outgoing",type:"Áudio",text:"[Áudio sem transcrição]",transcript:"Resposta falada sem correção."}
  ]
};

test("gera Markdown factual com identificadores, hash, completude e transcrição",async()=>{
  const result=await exporter.createExport(completeRecord,{date:new Date(2026,8,3)});
  assert.equal(result.filename,"WhatsApp_Joao-D-Avila-Teste_2026-09-03.md");
  assert.match(result.markdown,/- Captura do histórico: COMPLETA/);
  assert.match(result.markdown,/- Estado consolidado de integridade: COMPLETA/);
  assert.match(result.markdown,/- Total real de mensagens exportadas: 2/);
  assert.match(result.markdown,/- conversation_hash: [a-f0-9]{64}/);
  assert.match(result.markdown,/- Último message_id: M2/);
  assert.match(result.markdown,/- Timestamp da última mensagem: 2026-08-01T13:01:00\.000Z/);
  assert.match(result.markdown,/Transcrição de áudio existente:[\s\S]*Resposta falada sem correção\./);
  assert.match(result.markdown,/Olá, quero preservar `este` texto\./);
});

test("não inclui campos de análise, resumo, recomendação ou score",async()=>{
  const markdown=(await exporter.createExport(completeRecord)).markdown;
  for(const forbidden of ["NÃO EXPORTAR RESUMO","NÃO EXPORTAR ANÁLISE","NÃO EXPORTAR CHEFE","NÃO EXPORTAR SCORE","whatsapp_summary","whatsapp_analysis_full","whatsapp_analysis_hard_boss","chefe_duro"])assert.equal(markdown.includes(forbidden),false);
});

test("exporta todas as mensagens canônicas sem limite visual ou limite de caracteres",async()=>{
  const largeText="x".repeat(310000),entries=Array.from({length:125},(_,index)=>({message_id:`id-${index}`,timestamp:`2026-08-01T10:${String(index%60).padStart(2,"0")}:00-03:00`,sender:"Cliente",direction:"incoming",text:index===0?largeText:`Mensagem ${index}`}));
  const result=await exporter.createExport({...completeRecord,whatsapp_message_entries:entries});
  assert.equal(result.messages.length,125);
  assert.equal((result.markdown.match(/^### Mensagem /gm)||[]).length,125);
  assert(result.markdown.length>300000);
  assert(result.markdown.includes(largeText));
});

test("traduz integralmente os indicadores canônicos de áudio e captura incompleta",async()=>{
  const record={...completeRecord,whatsapp_capture_complete:false,whatsapp_message_entries:[
    {message_id:"a1",type:"Áudio",sender:"Cliente",direction:"incoming",date:"01/08/2026",message_time:"10:00",text:"[Áudio sem transcrição]"},
    {message_id:"a2",type:"Áudio",sender:"Cliente",direction:"incoming",date:"01/08/2026",message_time:"10:01",text:"[Áudio sem transcrição]",transcription_status:"transcription_error"},
    {message_id:"a3",type:"Áudio",sender:"Cliente",direction:"incoming",date:"01/08/2026",message_time:"10:02",text:"[Áudio sem transcrição]",media_status:"media_unavailable"}
  ]};
  const result=await exporter.createExport(record);
  assert.match(result.markdown,/- Captura do histórico: INCOMPLETA/);
  assert.match(result.markdown,/- Captura potencialmente incompleta: SIM/);
  assert.match(result.markdown,/- Áudios sem transcrição: 1/);
  assert.match(result.markdown,/- Áudios com erro de transcrição: 1/);
  assert.match(result.markdown,/- Mídias de áudio indisponíveis: 1/);
  assert.match(result.markdown,/- Áudios com metadados pendentes: 1/);
  for(const reason of result.completeness.completeness_reasons)assert(result.markdown.includes(reason));
});

test("usa DESCONHECIDO quando o dado factual não está disponível",async()=>{
  const record={whatsapp_message_entries:[{message_id:"m1",text:"Mensagem sem metadados"},{message_id:"m2",text:"Outra mensagem sem metadados"}]};
  const result=await exporter.createExport(record);
  assert.match(result.markdown,/- ID do cadastro: DESCONHECIDO/);
  assert.match(result.markdown,/- Timestamp da última mensagem: DESCONHECIDO/);
  assert.match(result.markdown,/- timestamp: DESCONHECIDO/);
});

test("sem mensagens rejeita com a mensagem exata e não cria download",async()=>{
  await assert.rejects(()=>exporter.createExport({id:"vazio",whatsapp_message_entries:[]}),{message:"Este cliente ainda não possui uma conversa do WhatsApp capturada."});
  let created=false;
  const environment={Blob,URL:{createObjectURL(){created=true;return "blob:test";},revokeObjectURL(){}},document:{createElement(){return {};},body:{appendChild(){}}},setTimeout(){}};
  await assert.rejects(()=>exporter.download({id:"vazio"},{environment}),{message:"Este cliente ainda não possui uma conversa do WhatsApp capturada."});
  assert.equal(created,false);
});

test("download usa Blob local, nome sanitizado e revoga a URL",async()=>{
  const state={clicked:false,removed:false,revoked:false,blob:null};
  const link={style:{},click(){state.clicked=true;},remove(){state.removed=true;}};
  const environment={Blob,URL:{createObjectURL(blob){state.blob=blob;return "blob:local";},revokeObjectURL(url){state.revoked=url==="blob:local";}},document:{createElement(tag){assert.equal(tag,"a");return link;},body:{appendChild(value){assert.equal(value,link);}}},setTimeout(callback){callback();}};
  const result=await exporter.download(completeRecord,{date:new Date(2026,8,3),environment});
  assert.equal(link.download,result.filename);assert.equal(link.href,"blob:local");assert.equal(state.blob.type,"text/markdown;charset=utf-8");assert.equal(state.clicked,true);assert.equal(state.removed,true);assert.equal(state.revoked,true);
});

test("index integra somente o exportador local no bloco de ações do WhatsApp",async()=>{
  const index=await readFile(new URL("../index.html",import.meta.url),"utf8"),source=await readFile(new URL("../whatsapp-chatgpt-export.js",import.meta.url),"utf8");
  assert.match(index,/id="btnExportConversationChatGpt"[^>]*>Exportar conversa para ChatGPT<\/button>/);
  assert.match(index,/<script src="whatsapp-chatgpt-export\.js\?v=1\.0\.0"><\/script>/);
  assert.match(index,/CriareWhatsAppChatGptExport\.download\(record\)/);
  assert.match(index,/\$\("whatsappSection"\)\.hidden = specifier;/);
  assert.match(index,/\$\("whatsappSection"\)\.setAttribute\("aria-hidden",String\(specifier\)\);/);
  assert.doesNotMatch(source,/buildCustomGptPrompt|slice\(-80\)|300000|fetch\(|XMLHttpRequest|supabase|\.from\(/i);
});
