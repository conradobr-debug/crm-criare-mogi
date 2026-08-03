import assert from "node:assert/strict";
import test from "node:test";
import "../whatsapp-sync-receipt.js";

const engine=globalThis.CriareWhatsAppSyncReceipt;
const records=[
  {id:"lead-1",phone:"+55 19 99999-0001",whatsapp_analysis_status:"stale",whatsapp_analysis_last_message_id:"MSG1"},
  {id:"lead-2",phone:"+55 19 99999-0002",whatsapp_analysis_status:"current"}
];
const receipt={schema_version:engine.SCHEMA,batch_id:"20260802-2200-ABCD",generated_at:"2026-08-03T01:00:00Z",processed:[],unchanged:[{lead_id:"lead-1",checked_at:"2026-08-03T01:00:00Z",cursor_confirmed:true,observed_last_message_id:"MSG1"}],failures:[],recent_inventory:[],possible_new_conversations:[{external_chat_id:"5519999990003@c.us",phone_e164:"+5519999990003",display_name:"Novo contato",last_message_id:"MSG9",last_message_at:"2026-08-03T00:50:00Z"}]};

test("retorno confirmado marca conversa inalterada como atual",()=>{
  const plan=engine.receiptPlan(receipt,records);
  assert.equal(plan.patches.length,1);
  assert.equal(plan.patches[0].patch.whatsapp_analysis_status,"current");
  assert.equal(plan.patches[0].patch.whatsapp_sync_status,"current");
});

test("conversa recente sem telefone conhecido vira possível novo lead",()=>{
  const plan=engine.receiptPlan(receipt,records);
  assert.equal(plan.summary.possible_new,1);
  assert.equal(plan.discoveries[0].classification,"possible_new_lead");
});

test("telefone já existente não cria novo lead",()=>{
  const known=structuredClone(receipt);known.possible_new_conversations[0].phone_e164="+5519999990002";
  assert.equal(engine.receiptPlan(known,records).discoveries[0].classification,"known_contact");
});

test("schema desconhecido é rejeitado",()=>{
  assert.throws(()=>engine.validate({...receipt,schema_version:"outro"}),/incompatível/);
});
