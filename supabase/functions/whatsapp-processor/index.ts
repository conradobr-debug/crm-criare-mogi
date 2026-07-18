import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeCriareConversation } from "../_shared/criare-whatsapp-analyzer.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROCESSOR_SECRET = Deno.env.get("WHATSAPP_PROCESSOR_SECRET") || "";
const ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_API_VERSION") || "v25.0";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const TRANSCRIPTION_MODEL = Deno.env.get("OPENAI_TRANSCRIPTION_MODEL") || "gpt-4o-mini-transcribe";
const DEFAULT_WORKSPACE = "00000000-0000-4000-8000-000000000001";
const MEDIA_BUCKET = "crm-whatsapp-media";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
type Json = Record<string, any>;

function json(body: Json, status=200){ return new Response(JSON.stringify(body), {status,headers:{"content-type":"application/json"}}); }
function digits(value: unknown){ return String(value || "").replace(/\D/g, ""); }
function isoFromSeconds(value: unknown){ const n=Number(value); return Number.isFinite(n)&&n>0?new Date(n*1000).toISOString():new Date().toISOString(); }
function safe(value: unknown,max=5000){ return typeof value==="string"?value.trim().slice(0,max):""; }
function equal(left:string,right:string){ if(!left||left.length!==right.length)return false;let x=0;for(let i=0;i<left.length;i++)x|=left.charCodeAt(i)^right.charCodeAt(i);return x===0; }
async function userFrom(request:Request){const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!token)return null;const {data}=await admin.auth.getUser(token);return data.user||null;}
function internal(request:Request){ return Boolean(PROCESSOR_SECRET&&equal(request.headers.get("x-crm-processor-secret")||"",PROCESSOR_SECRET)); }

function contentOf(message:Json){
  const type=String(message.type||"text");
  if(type==="text") return {body:safe(message.text?.body),mediaId:""};
  if(type==="button") return {body:safe(message.button?.text||message.button?.payload)||"[Botão]",mediaId:""};
  if(type==="interactive"){const r=message.interactive?.button_reply||message.interactive?.list_reply||{};return {body:safe(r.title||r.description)||"[Resposta interativa]",mediaId:""};}
  if(type==="image"||type==="video"||type==="document"||type==="audio"||type==="voice"||type==="sticker"){
    const media=message[type]||{};const labels:{[key:string]:string}={image:"Imagem",video:"Vídeo",document:"Documento",audio:"Áudio",voice:"Áudio",sticker:"Figurinha"};
    return {body:safe(media.caption)||`[${labels[type]}${media.filename?`: ${safe(media.filename,200)}`:""}]`,mediaId:safe(media.id,300)};
  }
  if(type==="location"){const l=message.location||{};return {body:`[Localização] ${safe(l.name||l.address||`${l.latitude||""}, ${l.longitude||""}`)}`.trim(),mediaId:""};}
  if(type==="reaction") return {body:`[Reação] ${safe(message.reaction?.emoji,20)}`.trim(),mediaId:""};
  if(type==="contacts") return {body:"[Contato compartilhado]",mediaId:""};
  return {body:`[${type}]`,mediaId:""};
}

async function accountFor(workspaceId:string,wabaId:string,metadata:Json){
  const phoneId=safe(metadata?.phone_number_id,200);if(!phoneId)throw new Error("PHONE_NUMBER_ID_MISSING");
  const payload={workspace_id:workspaceId,waba_id:wabaId||"unknown",phone_number_id:phoneId,display_phone_number:safe(metadata?.display_phone_number,80)||null,last_webhook_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const {data,error}=await admin.from("crm_whatsapp_accounts").upsert(payload,{onConflict:"workspace_id,phone_number_id"}).select("*").single();if(error)throw error;return data;
}

async function matchRecord(contactWaId:string,workspaceId:string){
  const {data,error}=await admin.from("crm_records").select("id,phone").eq("workspace_id",workspaceId);if(error)throw error;
  const matches=(data||[]).filter(r=>digits(r.phone)===contactWaId);
  return {recordId:matches.length===1?matches[0].id:null,status:matches.length===1?"matched":matches.length>1?"ambiguous":"unmatched",count:matches.length};
}

async function conversationFor(account:Json,contactWaId:string,contactName=""){
  const matched=await matchRecord(contactWaId,account.workspace_id);
  const payload={workspace_id:account.workspace_id,account_id:account.id,record_id:matched.recordId,contact_wa_id:contactWaId,contact_name:contactName||null,match_status:matched.status,match_details:{phone_match_count:matched.count},updated_at:new Date().toISOString()};
  const {data,error}=await admin.from("crm_whatsapp_conversations").upsert(payload,{onConflict:"account_id,contact_wa_id"}).select("*").single();if(error)throw error;return data;
}

async function enqueue(payload:Json){const {error}=await admin.from("crm_whatsapp_processing_jobs").upsert(payload,{onConflict:"job_type,idempotency_key",ignoreDuplicates:true});if(error)throw error;}

async function saveMessage(eventId:string,account:Json,value:Json,message:Json,direction:"inbound"|"outbound",contactWaId:string,contactName="",source="cloud_api"){
  contactWaId=digits(contactWaId);if(!message?.id||!contactWaId)return null;
  const conversation=await conversationFor(account,contactWaId,contactName);const content=contentOf(message);const timestamp=isoFromSeconds(message.timestamp);
  const payload={meta_message_id:String(message.id),workspace_id:account.workspace_id,account_id:account.id,conversation_id:conversation.id,webhook_event_id:eventId,record_id:conversation.record_id,contact_wa_id:contactWaId,contact_name:contactName||null,direction,message_type:String(message.type||"text"),body:content.body||null,media_id:content.mediaId||null,source,status:direction==="outbound"?"sent":"received",message_timestamp:timestamp,sender_wa_id:digits(message.from),recipient_wa_id:digits(message.to),reply_to_message_id:safe(message.context?.id,300)||null,mime_type:message[message.type]?.mime_type||null,file_name:message.document?.filename||null,raw_message:message,metadata:{context_message_id:message.context?.id||null,referral:message.referral||null},processed_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const {data,error}=await admin.from("crm_whatsapp_messages").upsert(payload,{onConflict:"meta_message_id"}).select("*").single();if(error)throw error;
  const update:any={first_message_at:conversation.first_message_at||timestamp,last_message_at:timestamp,last_message_id:String(message.id),last_sync_at:new Date().toISOString(),analysis_status:"stale",analysis_error:null,updated_at:new Date().toISOString()};
  update[direction==="inbound"?"last_inbound_at":"last_outbound_at"]=timestamp;
  const {error:conversationError}=await admin.from("crm_whatsapp_conversations").update(update).eq("id",conversation.id);if(conversationError)throw conversationError;
  if(conversation.record_id) await admin.from("crm_records").update({whatsapp_official_last_sync_at:new Date().toISOString(),whatsapp_official_sync_error:null,whatsapp_analysis_status:"stale"}).eq("id",conversation.record_id);
  if(content.mediaId){
    const mediaPayload={workspace_id:account.workspace_id,message_id:data.id,meta_media_id:content.mediaId,media_type:String(message.type),mime_type:payload.mime_type,file_name:payload.file_name,transcription_status:["audio","voice"].includes(message.type)?"pending":"not_applicable"};
    const {data:media,error:mediaError}=await admin.from("crm_whatsapp_media").upsert(mediaPayload,{onConflict:"message_id,meta_media_id"}).select("*").single();if(mediaError)throw mediaError;
    await enqueue({workspace_id:account.workspace_id,job_type:"media",idempotency_key:content.mediaId,message_id:data.id,media_id:media.id,conversation_id:conversation.id,record_id:conversation.record_id,priority:20});
  }
  return data;
}

async function updateStatus(status:Json){
  if(!status?.id)return;const at=isoFromSeconds(status.timestamp);
  const {data}=await admin.from("crm_whatsapp_messages").select("status_history").eq("meta_message_id",String(status.id)).maybeSingle();
  const history=Array.isArray(data?.status_history)?data.status_history:[];history.push({status:status.status||null,at,errors:status.errors||[]});
  await admin.from("crm_whatsapp_messages").update({status:status.status||null,status_timestamp:at,status_history:history.slice(-30),updated_at:new Date().toISOString()}).eq("meta_message_id",String(status.id));
}

async function processValue(eventId:string,wabaId:string,value:Json,field="messages"){
  const account=await accountFor(DEFAULT_WORKSPACE,wabaId,value.metadata||{});const contacts=new Map<string,string>();
  for(const c of value.contacts||[])contacts.set(digits(c.wa_id),safe(c.profile?.name,200));
  const isEcho=["smb_message_echoes","message_echoes"].includes(field);
  if(isEcho)await admin.from("crm_whatsapp_accounts").update({coexistence_enabled:true,updated_at:new Date().toISOString()}).eq("id",account.id);
  if(!isEcho)for(const m of value.messages||[]){const wa=digits(m.from);await saveMessage(eventId,account,value,m,"inbound",wa,contacts.get(wa)||"","cloud_api");}
  if(!isEcho)for(const s of value.statuses||[])await updateStatus(s);
  const echoes=isEcho?(value.message_echoes||value.echoes||value.messages||[]):(value.message_echoes||value.echoes||[]);
  for(const m of echoes){const wa=digits(m.to||m.recipient_id||m.context?.from);await saveMessage(eventId,account,value,m,"outbound",wa,contacts.get(wa)||"","whatsapp_business_app");}
}

async function processWebhook(job:Json){
  const {data:event,error}=await admin.from("crm_whatsapp_webhook_events").select("*").eq("id",job.webhook_event_id).single();if(error)throw error;
  await admin.from("crm_whatsapp_webhook_events").update({processing_status:"processing",attempts:event.attempts+1,locked_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",event.id);
  const payload=event.payload;
  if(payload?.object==="whatsapp_business_account")for(const entry of payload.entry||[])for(const change of entry.changes||[])await processValue(event.id,String(entry.id||""),change.value||{},String(change.field||"messages"));
  const history=payload?.data?.history||payload?.history||[];
  for(const chunk of history)for(const thread of chunk.threads||[]){
    const metadata=payload?.data?.metadata||{};const account=await accountFor(DEFAULT_WORKSPACE,String(payload?.data?.id||payload?.id||"unknown"),metadata);const contact=digits(thread.id);
    for(const m of thread.messages||[])await saveMessage(event.id,account,{metadata},m,digits(m.from)===contact?"inbound":"outbound",contact,"","history_sync");
  }
  await admin.from("crm_whatsapp_webhook_events").update({processing_status:"processed",processed_at:new Date().toISOString(),locked_at:null,last_error:null,updated_at:new Date().toISOString()}).eq("id",event.id);
}

async function transcribe(media:Json,bytes:Uint8Array,mime:string){
  if(!OPENAI_API_KEY)return "";const form=new FormData();form.set("model",TRANSCRIPTION_MODEL);form.set("file",new Blob([bytes.buffer as ArrayBuffer],{type:mime}),media.file_name||`audio-${media.id}`);
  const response=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{authorization:`Bearer ${OPENAI_API_KEY}`},body:form});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`TRANSCRIPTION_${response.status}`);return safe(body.text,20000);
}

async function processMedia(job:Json){
  if(!ACCESS_TOKEN)throw new Error("WHATSAPP_ACCESS_TOKEN_NOT_CONFIGURED");
  const {data:media,error}=await admin.from("crm_whatsapp_media").select("*,crm_whatsapp_messages(*)").eq("id",job.media_id).single();if(error)throw error;
  await admin.from("crm_whatsapp_media").update({download_status:"downloading",attempts:media.attempts+1,updated_at:new Date().toISOString()}).eq("id",media.id);
  const metaResponse=await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(media.meta_media_id)}`,{headers:{authorization:`Bearer ${ACCESS_TOKEN}`}});const meta=await metaResponse.json().catch(()=>({}));if(!metaResponse.ok||!meta.url)throw new Error(`META_MEDIA_METADATA_${metaResponse.status}`);
  const fileResponse=await fetch(meta.url,{headers:{authorization:`Bearer ${ACCESS_TOKEN}`}});if(!fileResponse.ok)throw new Error(`META_MEDIA_DOWNLOAD_${fileResponse.status}`);const bytes=new Uint8Array(await fileResponse.arrayBuffer());if(bytes.byteLength>26214400)throw new Error("MEDIA_TOO_LARGE");
  const mime=String(meta.mime_type||media.mime_type||fileResponse.headers.get("content-type")||"application/octet-stream").split(";")[0];const ext=(mime.split("/")[1]||"bin").replace(/[^a-z0-9.+-]/gi,"");const path=`${media.workspace_id}/${media.message_id}/${media.meta_media_id}.${ext}`;
  const {error:uploadError}=await admin.storage.from(MEDIA_BUCKET).upload(path,bytes,{contentType:mime,upsert:true,cacheControl:"3600"});if(uploadError)throw uploadError;
  let transcript="";let transcriptionStatus=media.transcription_status;
  if(["audio","voice"].includes(media.media_type)){transcriptionStatus="processing";await admin.from("crm_whatsapp_media").update({transcription_status:"processing"}).eq("id",media.id);try{transcript=await transcribe(media,bytes,mime);transcriptionStatus=transcript?"completed":"failed";}catch(error){transcriptionStatus="failed";}}
  await admin.from("crm_whatsapp_media").update({mime_type:mime,size_bytes:bytes.byteLength,sha256:meta.sha256||null,storage_path:path,download_status:"stored",downloaded_at:new Date().toISOString(),transcription_status:transcriptionStatus,transcription:transcript||null,last_error:null,updated_at:new Date().toISOString()}).eq("id",media.id);
  const message=media.crm_whatsapp_messages;if(message)await admin.from("crm_whatsapp_messages").update({mime_type:mime,media_size_bytes:bytes.byteLength,media_sha256:meta.sha256||null,body:transcript?`[Transcrição de áudio] ${transcript}`:message.body,updated_at:new Date().toISOString()}).eq("id",message.id);
}

async function conversationText(conversationId:string){let rows:any[]=[];for(let from=0;from<5000;from+=1000){const {data,error}=await admin.from("crm_whatsapp_messages").select("id,meta_message_id,direction,message_type,body,message_timestamp,status").eq("conversation_id",conversationId).order("message_timestamp",{ascending:true}).order("id",{ascending:true}).range(from,from+999);if(error)throw error;rows=rows.concat(data||[]);if((data||[]).length<1000)break;}return rows;}

async function analyzeRecord(recordId:string,triggeredBy:string,requestedBy:string|null=null){
  const {data:conversation,error:conversationError}=await admin.from("crm_whatsapp_conversations").select("*").eq("record_id",recordId).order("last_message_at",{ascending:false}).limit(1).maybeSingle();if(conversationError)throw conversationError;if(!conversation)throw new Error("CONVERSATION_NOT_FOUND");
  const messages=await conversationText(conversation.id);if(!messages.length)throw new Error("CONVERSATION_EMPTY");const last=messages[messages.length-1];
  const {data:record,error:recordError}=await admin.from("crm_records").select("*").eq("id",recordId).single();if(recordError)throw recordError;
  const {data:history,error:historyError}=await admin.from("crm_whatsapp_analysis_history").insert({workspace_id:conversation.workspace_id,conversation_id:conversation.id,record_id:recordId,triggered_by:triggeredBy,requested_by:requestedBy,status:"processing",previous_hard_boss:record.whatsapp_analysis_hard_boss,previous_full_analysis:record.whatsapp_analysis_full,first_message_at:messages[0].message_timestamp,last_message_at:last.message_timestamp,last_message_id:last.meta_message_id,message_count:messages.length}).select("*").single();if(historyError)throw historyError;
  await admin.from("crm_whatsapp_conversations").update({analysis_status:"processing",analysis_error:null}).eq("id",conversation.id);
  try{
    const text=messages.map(m=>`[${new Date(m.message_timestamp).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}] ${m.direction==="inbound"?"Cliente":"Criare"} (${m.message_type}): ${m.body||"[sem conteúdo textual]"}`).join("\n");
    const result=await analyzeCriareConversation({conversation:text,analysisMode:"Análise completa",previousAnalysis:record.whatsapp_analysis_full||"",context:{nome:[record.first_name,record.last_name].filter(Boolean).join(" "),etapa:record.stage,ambientes:record.rooms,cidade:record.city,origem:record.source,observacoes:record.notes}});
    const now=new Date().toISOString();
    await admin.from("crm_whatsapp_analysis_history").update({status:"completed",hard_boss:result.hard_boss,full_analysis:result.full_analysis,structured_analysis:result,model:result.model,completed_at:now}).eq("id",history.id);
    await admin.from("crm_records").update({whatsapp_summary:result.hard_boss,whatsapp_summary_updated_at:now,whatsapp_summary_model:result.model,whatsapp_analysis_hard_boss:result.hard_boss,whatsapp_analysis_full:result.full_analysis,whatsapp_analysis_updated_at:now,whatsapp_analysis_model:result.model,whatsapp_analysis_status:"current",whatsapp_analysis_last_message_id:last.meta_message_id,whatsapp_analysis_message_count:messages.length,whatsapp_analysis_structured:result,lead_quality:result.lead_quality}).eq("id",recordId);
    await admin.from("crm_whatsapp_conversations").update({analysis_status:"current",analysis_error:null,new_messages_since_analysis:0,updated_at:now}).eq("id",conversation.id);
    return {record_id:recordId,conversation_id:conversation.id,analysis:result,updated_at:now,message_count:messages.length};
  }catch(error){const message=error instanceof Error?error.message:String(error);await admin.from("crm_whatsapp_analysis_history").update({status:"failed",error:message,completed_at:new Date().toISOString()}).eq("id",history.id);await admin.from("crm_whatsapp_conversations").update({analysis_status:"failed",analysis_error:message}).eq("id",conversation.id);await admin.from("crm_records").update({whatsapp_analysis_status:"failed"}).eq("id",recordId);throw error;}
}

async function completeJob(job:Json){await admin.from("crm_whatsapp_processing_jobs").update({status:"completed",completed_at:new Date().toISOString(),locked_at:null,locked_by:null,last_error:null,updated_at:new Date().toISOString()}).eq("id",job.id);}
async function failJob(job:Json,error:unknown){const message=error instanceof Error?error.message:String(error);const dead=job.attempts>=job.max_attempts;const delay=Math.min(3600,Math.pow(2,Math.max(1,job.attempts))*30);await admin.from("crm_whatsapp_processing_jobs").update({status:dead?"dead_letter":"retry",available_at:new Date(Date.now()+delay*1000).toISOString(),locked_at:null,locked_by:null,last_error:message.slice(0,2000),updated_at:new Date().toISOString()}).eq("id",job.id);if(job.webhook_event_id)await admin.from("crm_whatsapp_webhook_events").update({processing_status:dead?"dead_letter":"failed",last_error:message.slice(0,2000),next_attempt_at:new Date(Date.now()+delay*1000).toISOString(),locked_at:null,updated_at:new Date().toISOString()}).eq("id",job.webhook_event_id);}

async function processQueue(limit=10){const worker=crypto.randomUUID();const {data:jobs,error}=await admin.rpc("claim_crm_whatsapp_jobs",{p_worker:worker,p_limit:Math.max(1,Math.min(limit,25))});if(error)throw error;const result={claimed:(jobs||[]).length,completed:0,failed:0};for(const job of jobs||[]){try{if(job.job_type==="webhook")await processWebhook(job);else if(job.job_type==="media")await processMedia(job);else if(job.job_type==="analysis")await analyzeRecord(job.record_id,String(job.payload?.triggered_by||"retry"));await completeJob(job);result.completed++;}catch(error){console.error("[WhatsApp processor] job failed",{job:job.id,type:job.job_type,error:error instanceof Error?error.message:String(error)});await failJob(job,error);result.failed++;}}return result;}

Deno.serve(async(request)=>{
  if(request.method!=="POST")return json({error:"Método não permitido."},405);const body=await request.json().catch(()=>({}));const action=String(body.action||"process_queue");
  if(action==="analyze_record"){
    const user=await userFrom(request);if(!user)return json({error:"Sessão inválida."},401);const recordId=safe(body.record_id,100);if(!recordId)return json({error:"Lead não informado."},400);
    const {data:conversation}=await admin.from("crm_whatsapp_conversations").select("workspace_id").eq("record_id",recordId).limit(1).maybeSingle();if(!conversation)return json({error:"Conversa oficial ainda não encontrada para este lead."},404);
    const {data:member}=await admin.from("crm_workspace_members").select("role").eq("workspace_id",conversation.workspace_id).eq("user_id",user.id).maybeSingle();if(!member)return json({error:"Sem autorização para este workspace."},403);
    try{return json({ok:true,...await analyzeRecord(recordId,"manual",user.id)});}catch(error){return json({error:error instanceof Error?error.message:"Falha na análise."},500);}
  }
  if(!internal(request))return json({error:"Não autorizado."},401);
  if(action==="configure_automation"){await admin.rpc("configure_crm_whatsapp_processor",{p_project_url:SUPABASE_URL,p_secret:PROCESSOR_SECRET});return json({ok:true});}
  try{return json({ok:true,...await processQueue(Number(body.limit||10))});}catch(error){return json({error:error instanceof Error?error.message:"Falha no processamento."},500);}
});
