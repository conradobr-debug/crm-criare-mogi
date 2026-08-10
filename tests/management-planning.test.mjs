import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

await import("../batch-analysis.js");
await import("../management-planning.js");
const planning=globalThis.CriareManagementPlanning;

const profiles=[{id:"00000000-0000-4000-8000-000000000101",display_name:"Vendedor"},{id:"00000000-0000-4000-8000-000000000102",display_name:"Gestor"}];
const roles={"00000000-0000-4000-8000-000000000101":"member","00000000-0000-4000-8000-000000000102":"manager"};
const analysis={recommended_next_actions:[{priority:"high",action:"Retomar contato",owner:"seller",due_in_hours:4,estimated_minutes:20,suggested_message:"Podemos conversar?",suggested_speech:"Confirmar prazo e orçamento."}],batch_metadata:{conversation_hash:"abc",analyzed_until_message_id:"MSG-1"}};
const records=[
  {id:"00000000-0000-4000-8000-000000000201",first_name:"Lead",pipeline:"lead",stage:"Qualificação",owner_id:profiles[0].id,whatsapp_analysis_status:"current",whatsapp_analysis_structured:analysis},
  {id:"00000000-0000-4000-8000-000000000202",first_name:"Cliente",pipeline:"closed",stage:"Pós-venda",owner_id:profiles[0].id,whatsapp_analysis_status:"current",whatsapp_analysis_structured:analysis},
  {id:"00000000-0000-4000-8000-000000000203",first_name:"Parceiro",record_type:"specifier",pipeline:"lead",stage:"Relacionamento",owner_id:profiles[1].id,whatsapp_analysis_status:"current",whatsapp_analysis_structured:analysis},
  {id:"00000000-0000-4000-8000-000000000204",first_name:"Assistência",record_type:"pending_contact",pipeline:"support",stage:"Em acompanhamento",owner_id:profiles[0].id,whatsapp_analysis_status:"current",whatsapp_analysis_structured:analysis}
];
const pendingItems=[{id:"00000000-0000-4000-8000-000000000301",title:"Trocar peça",status:"open",priority:"Alta",owner_id:profiles[0].id},{id:"00000000-0000-4000-8000-000000000302",title:"Pendência vinculada",status:"open",whatsapp_record_id:records[3].id,owner_id:profiles[0].id}];
const capacity={default:{max_actions:1,max_minutes:30},roles:{member:{max_actions:1,max_minutes:30},manager:{max_actions:1,max_minutes:30}},users:{}};

async function snapshot(){return planning.buildPortfolio({records,pendingItems,profiles,roles,capacity,workspaceId:"00000000-0000-4000-8000-000000000001",now:"2026-08-10T12:00:00.000Z"});}

test("snapshot gerencial inclui leads, fechados, parceiros e pendências",async()=>{
  const value=await snapshot();
  assert.equal(value.entities.length,5);
  assert.deepEqual([...new Set(value.entities.map(item=>item.entity_type))].sort(),["closed","lead","partner","pending"]);
  assert.equal(value.entities.find(item=>item.entity_id===records[3].id).open_pendings.length,1);
  assert.equal(value.entities.find(item=>item.entity_id===pendingItems[0].id).entity_type,"pending");
});

test("snapshot global não exporta mensagens integrais",async()=>{
  const serialized=JSON.stringify(await snapshot());
  assert.equal(serialized.includes("whatsapp_message_entries"),false);
  assert.equal(serialized.includes("suggested_speech"),true);
});

test("resultado só é aceito para o mesmo snapshot e IDs reais",async()=>{
  const value=await snapshot(),payload={schema_version:planning.outputSchemaVersion,prompt_version:planning.promptVersion,snapshot_id:value.snapshot_id,portfolio_hash:value.portfolio_hash,actions:[{entity_type:"lead",entity_id:records[0].id,owner_id:profiles[0].id,priority:"high",time_horizon:"today",action:"Responder",reason:"Cliente aguarda",estimated_minutes:20,evidence:["Pergunta aberta"]}],coverage:{reviewed_entity_ids:value.entities.map(item=>item.entity_id),not_actionable:value.entities.slice(1).map(item=>({entity_type:item.entity_type,entity_id:item.entity_id,reason:"Sem ação necessária agora"}))}};
  assert.equal(planning.validateResult(payload,value).valid,true);
  assert.equal(planning.validateResult({...payload,portfolio_hash:"alterado"},value).valid,false);
  payload.actions[0].entity_id="00000000-0000-4000-8000-999999999999";
  assert.equal(planning.validateResult(payload,value).valid,false);
});

test("resultado incompleto ou atribuído ao responsável errado é bloqueado",async()=>{
  const value=await snapshot(),base={schema_version:planning.outputSchemaVersion,prompt_version:planning.promptVersion,snapshot_id:value.snapshot_id,portfolio_hash:value.portfolio_hash,actions:[{entity_type:"lead",entity_id:records[0].id,owner_id:profiles[1].id,priority:"high",time_horizon:"today",action:"Responder",reason:"Cliente aguarda",estimated_minutes:20}],coverage:{reviewed_entity_ids:value.entities.map(item=>item.entity_id),not_actionable:value.entities.slice(1).map(item=>({entity_type:item.entity_type,entity_id:item.entity_id,reason:"Sem ação necessária agora"}))}};
  assert.match(planning.validateResult(base,value).errors.join(" "),/responsável não pertence/);
  const correct={...base,actions:[{...base.actions[0],owner_id:profiles[0].id}],coverage:{...base.coverage,reviewed_entity_ids:[records[0].id]}};
  assert.match(planning.validateResult(correct,value).errors.join(" "),/Cobertura incompleta/);
});

test("capacidade cheia transfere ações para a semana sem descartá-las",async()=>{
  const value=await snapshot(),actions=[
    {index:0,valid:true,entity_type:"lead",entity_id:records[0].id,owner_id:profiles[0].id,priority:"critical",time_horizon:"today",action:"Ação 1",reason:"",estimated_minutes:20,action_key:"1",evidence:[]},
    {index:1,valid:true,entity_type:"closed",entity_id:records[1].id,owner_id:profiles[0].id,priority:"high",time_horizon:"today",action:"Ação 2",reason:"",estimated_minutes:20,action_key:"2",evidence:[]},
    {index:2,valid:true,entity_type:"pending",entity_id:pendingItems[0].id,owner_id:profiles[0].id,priority:"medium",time_horizon:"today",action:"Ação 3",reason:"",estimated_minutes:20,action_key:"3",evidence:[]}
  ],planned=planning.allocateActions(actions,value,[],"2026-08-10T12:00:00.000Z");
  assert.equal(planned.length,3);
  assert.equal(planned.filter(item=>item.bucket==="today").length,1);
  assert.equal(planned.filter(item=>item.bucket==="week").length,2);
  assert.equal(planned.filter(item=>item.bucket==="backlog").length,0);
});

test("dependências permanecem aguardando e itens sem responsável não são atribuídos",async()=>{
  const value=await snapshot(),planned=planning.allocateActions([{index:0,valid:true,entity_type:"lead",entity_id:records[0].id,owner_id:null,priority:"medium",time_horizon:"waiting",action:"Aguardar documento",reason:"",estimated_minutes:15,action_key:"wait",evidence:[]}],value,[],"2026-08-10T12:00:00.000Z");
  assert.equal(planned[0].bucket,"waiting");assert.equal(planned[0].owner_id,null);assert.equal(planned[0].planned_date,null);
});

test("pacote gerencial contém instruções, schema e carteira",async()=>{
  const value=await snapshot(),files=planning.packageFiles(value),zip=globalThis.CriareBatchAnalysis.zipFiles(files);
  assert.deepEqual(Object.keys(files),["management_portfolio.json","management_plan_instructions.md","management_plan_output_schema.json","README.txt"]);
  assert.match(planning.inputFilename(value.snapshot_id),/^03-ENVIAR-AO-GPT_PLANO-DE-TRABALHO_/);
  assert(zip.length>100);
});

test("interface usa compromissos sugeridos e oferece visão de equipe",async()=>{
  const ui=await readFile(new URL("../management-planning-ui.js",import.meta.url),"utf8"),app=await readFile(new URL("../index.html",import.meta.url),"utf8");
  assert.match(ui,/Compromissos sugeridos/);assert.match(ui,/Agenda da equipe/);assert.match(ui,/Hoje/);assert.match(ui,/Esta semana/);assert.match(ui,/Aguardando/);assert.match(ui,/Confirmar compromisso/);
  assert.doesNotMatch(ui,/enviar automaticamente/i);
  assert.match(app,/id="individualRecommendations"/);assert.match(app,/Mensagem sugerida/);assert.match(app,/Orientação para conversa/);
});

test("migração preserva histórico e exige confirmação humana",async()=>{
  const migration=await readFile(new URL("../supabase/migrations/20260810173000_management_work_plans.sql",import.meta.url),"utf8");
  assert.match(migration,/status in \('suggested','accepted','completed','dismissed','superseded'\)/);
  assert.match(migration,/crm_has_workspace_access/);
  assert.doesNotMatch(migration,/delete from public\.crm_management_plan_items/i);
});
