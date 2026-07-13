import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN=Deno.env.get("WHATSAPP_VERIFY_TOKEN")||"";
const APP_SECRET=Deno.env.get("META_APP_SECRET")||"";
const PROCESSOR_SECRET=Deno.env.get("WHATSAPP_PROCESSOR_SECRET")||"";
const DEFAULT_WORKSPACE="00000000-0000-4000-8000-000000000001";
const admin=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

function constantTime(left:string,right:string){if(!left||left.length!==right.length)return false;let mismatch=0;for(let i=0;i<left.length;i++)mismatch|=left.charCodeAt(i)^right.charCodeAt(i);return mismatch===0;}
async function sha256(value:string){const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");}
async function validSignature(raw:string,signature:string|null){
  if(!APP_SECRET||!signature?.startsWith("sha256="))return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(APP_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(raw)));
  return constantTime(`sha256=${[...bytes].map(b=>b.toString(16).padStart(2,"0")).join("")}`,signature);
}
function safeHeaders(request:Request){return {"content-type":request.headers.get("content-type"),"user-agent":request.headers.get("user-agent"),"x-hub-signature-present":Boolean(request.headers.get("x-hub-signature-256"))};}
async function kickProcessor(){if(!PROCESSOR_SECRET)return;await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-processor`,{method:"POST",headers:{"content-type":"application/json","x-crm-processor-secret":PROCESSOR_SECRET},body:JSON.stringify({action:"process_queue",limit:10})});}

Deno.serve(async request=>{
  const url=new URL(request.url);
  if(request.method==="GET"){
    const valid=url.searchParams.get("hub.mode")==="subscribe"&&VERIFY_TOKEN&&constantTime(url.searchParams.get("hub.verify_token")||"",VERIFY_TOKEN);
    return valid?new Response(url.searchParams.get("hub.challenge")||"",{status:200,headers:{"content-type":"text/plain"}}):new Response("Verificação recusada",{status:403});
  }
  if(request.method!=="POST")return new Response("Método não permitido",{status:405});
  const raw=await request.text();const signature=request.headers.get("x-hub-signature-256");
  if(!await validSignature(raw,signature))return new Response("Assinatura inválida",{status:401});
  let payload:any;try{payload=JSON.parse(raw);}catch{return new Response("JSON inválido",{status:400});}
  const eventKey=await sha256(raw);const wabaId=String(payload?.entry?.[0]?.id||payload?.data?.id||"");
  let accountId:string|null=null;if(wabaId){const {data}=await admin.from("crm_whatsapp_accounts").select("id").eq("workspace_id",DEFAULT_WORKSPACE).eq("waba_id",wabaId).limit(1).maybeSingle();accountId=data?.id||null;}
  const {data:event,error}=await admin.from("crm_whatsapp_webhook_events").upsert({workspace_id:DEFAULT_WORKSPACE,account_id:accountId,external_event_key:eventKey,object_type:String(payload?.object||payload?.event||"unknown"),signature_valid:true,payload,headers:safeHeaders(request),processing_status:"pending",next_attempt_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"external_event_key",ignoreDuplicates:true}).select("id").maybeSingle();
  if(error){console.error("[WhatsApp webhook] persist failed",{code:error.code});return new Response("Falha temporária",{status:500});}
  const eventId=event?.id||(await admin.from("crm_whatsapp_webhook_events").select("id").eq("external_event_key",eventKey).single()).data?.id;
  if(eventId){const {error:jobError}=await admin.from("crm_whatsapp_processing_jobs").upsert({workspace_id:DEFAULT_WORKSPACE,job_type:"webhook",idempotency_key:eventKey,webhook_event_id:eventId,priority:10},{onConflict:"job_type,idempotency_key",ignoreDuplicates:true});if(jobError){console.error("[WhatsApp webhook] enqueue failed",{code:jobError.code});return new Response("Falha temporária",{status:500});}}
  if(typeof EdgeRuntime!=="undefined"&&PROCESSOR_SECRET)EdgeRuntime.waitUntil(kickProcessor().catch(error=>console.error("[WhatsApp webhook] kick failed",error instanceof Error?error.message:"error")));
  return new Response("EVENT_RECEIVED",{status:200});
});
