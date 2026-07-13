import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const serviceSource=fs.readFileSync(new URL("../whatsapp-data-service.js",import.meta.url),"utf8");
const calls=[];
function builder(result){
  const api={select(v){calls.push(["select",v]);return api;},eq(k,v){calls.push(["eq",k,v]);return api;},order(k,v){calls.push(["order",k,v]);return api;},limit(v){calls.push(["limit",v]);return api;},range(a,b){calls.push(["range",a,b]);return api;},maybeSingle(){return Promise.resolve(result);},then(resolve){return Promise.resolve(result).then(resolve);}};return api;
}
const supabaseClient={from(table){calls.push(["from",table]);return builder({data:table==="crm_whatsapp_conversations"?{id:"conversation-1"}:[],error:null});},storage:{from(){return {createSignedUrl:async()=>({data:{signedUrl:"https://signed.example/media"},error:null})};}}};
const context={window:{},fetch:async(url,init)=>({ok:true,json:async()=>({ok:true,analysis:{hard_boss:"Direto."},request:{url,init}})})};vm.createContext(context);vm.runInContext(serviceSource,context);
const service=context.window.CriareWhatsAppDataService.create({supabaseClient,supabaseUrl:"https://project.supabase.co",anonKey:"public-key",getAccessToken:async()=>"user-jwt"});
const conversation=await service.conversationForRecord("record-1");assert.equal(conversation.id,"conversation-1");assert(calls.some(call=>call[0]==="eq"&&call[1]==="record_id"&&call[2]==="record-1"));
await service.messages("conversation-1",{offset:60,limit:60});assert(calls.some(call=>call[0]==="range"&&call[1]===60&&call[2]===119));
const refreshed=await service.refreshAnalysis("record-1");assert.equal(refreshed.analysis.hard_boss,"Direto.");

const webhook=fs.readFileSync(new URL("../supabase/functions/whatsapp-webhook/index.ts",import.meta.url),"utf8");
assert.match(webhook,/x-hub-signature-256/i);assert.match(webhook,/crm_whatsapp_webhook_events/);assert.match(webhook,/crm_whatsapp_processing_jobs/);assert.doesNotMatch(webhook,/if\(!APP_SECRET\)return true/);
const migration=fs.readFileSync(new URL("../supabase/migrations/20260713120000_official_whatsapp_platform.sql",import.meta.url),"utf8");
for(const required of ["crm_whatsapp_accounts","crm_whatsapp_conversations","crm_whatsapp_media","crm_whatsapp_analysis_history","claim_crm_whatsapp_jobs","queue_daily_crm_whatsapp_analyses","enable row level security"])assert(migration.includes(required),`migration sem ${required}`);
const frontend=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");assert(!frontend.includes("WHATSAPP_ACCESS_TOKEN="));assert(frontend.includes("btnUpdateOfficialAnalysis"));assert(frontend.includes("hardBossPinned"));assert(frontend.includes("whatsappAnalysisModal"));
assert.match(frontend,/btnSyncWhatsAppAll[\s\S]{0,120}Extensão WhatsApp/);assert.match(frontend,/btnUpdateOfficialAnalysis[\s\S]{0,120}Capturar conversa/);assert.match(frontend,/btnAnalyzeAutomatic[\s\S]{0,120}Analisar automaticamente/);assert.match(frontend,/btnImportReadyAnalysis/);assert.match(frontend,/whatsapp:\/\/send\?phone=\$\{number\}/);assert.match(frontend,/window\.location\.assign\(webUrl\)/);assert.match(frontend,/if\(!isWindows\)return window\.open\(webUrl/);
const processor=fs.readFileSync(new URL("../supabase/functions/whatsapp-processor/index.ts",import.meta.url),"utf8");assert.match(processor,/smb_message_echoes/);assert.doesNotMatch(processor,/lead_quality:result\.lead_quality,next_action_kind:/);
console.log("whatsapp-official.test.mjs: ok");
