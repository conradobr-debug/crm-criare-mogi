(function(global){
  "use strict";

  const INPUT_SCHEMA="criare-management-plan-input-1.0";
  const OUTPUT_SCHEMA="criare-management-plan-result-1.0";
  const PROMPT_VERSION="criare-management-plan-v1";
  const MODULE_VERSION="1.0.0";
  const PRIORITIES=new Set(["critical","high","medium","low"]);
  const HORIZONS=new Set(["today","week","waiting"]);
  const ENTITY_TYPES=new Set(["lead","closed","partner","pending"]);
  const PRIORITY_WEIGHT={critical:4,high:3,medium:2,low:1};

  const clean=value=>String(value??"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,"").replace(/\s+/g," ").trim();
  const cleanMultiline=value=>String(value??"").replace(/\r\n?/g,"\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,"").replace(/\n{4,}/g,"\n\n\n").trim();
  const stable=value=>value&&typeof value==="object"?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]))):value;
  async function sha256(value){const bytes=new TextEncoder().encode(typeof value==="string"?value:JSON.stringify(stable(value)));const digest=await global.crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
  function entityType(record){if(record?.record_type==="specifier")return "partner";if(record?.record_type==="pending_contact")return "pending";return record?.pipeline==="closed"?"closed":"lead";}
  function ownerIds(record){return [...new Set([record?.owner_id,...(Array.isArray(record?.owner_ids)?record.owner_ids:[])].filter(Boolean).map(String))];}
  function appointments(record){return (Array.isArray(record?.appointments)?record.appointments:[]).filter(item=>item?.starts_at&&(item.status||"scheduled")==="scheduled").map(item=>({starts_at:item.starts_at,duration_minutes:Number(item.duration_minutes||30),status:"scheduled",kind:clean(item.kind||"Compromisso")}));}
  function analysisSummary(record){const structured=record?.whatsapp_analysis_structured&&typeof record.whatsapp_analysis_structured==="object"?record.whatsapp_analysis_structured:{};return {status:clean(record?.whatsapp_analysis_status||"never"),updated_at:record?.whatsapp_analysis_updated_at||null,conversation_hash:clean(structured?.batch_metadata?.conversation_hash||"")||null,analyzed_until_message_id:clean(structured?.batch_metadata?.analyzed_until_message_id||record?.whatsapp_analysis_last_message_id||"")||null,verdict:clean(record?.whatsapp_analysis_hard_boss||record?.whatsapp_summary||"")||null,full_analysis:cleanMultiline(record?.whatsapp_analysis_full||"")||null,recommended_next_actions:Array.isArray(structured?.recommended_next_actions)?structured.recommended_next_actions.map(action=>({priority:action.priority,action:clean(action.action),owner:action.owner,due_in_hours:Number(action.due_in_hours),estimated_minutes:Number(action.estimated_minutes||20),suggested_message:clean(action.suggested_message)||null,suggested_speech:clean(action.suggested_speech)||null})).filter(action=>action.action):[]};}
  function pendingSummary(item){return {id:String(item.id),title:clean(item.title||"Pendência"),type:clean(item.pending_type||"Outro"),priority:clean(item.priority||"Normal"),status:clean(item.status||"open"),due_at:item.due_at||null,description:cleanMultiline(item.description||"")||null,owner_ids:[...new Set([item.owner_id,...(Array.isArray(item.owner_ids)?item.owner_ids:[])].filter(Boolean).map(String))],linked_record_id:item.whatsapp_record_id?String(item.whatsapp_record_id):null};}
  function profileMap(profiles=[]){return new Map(profiles.map(profile=>[String(profile.id),{id:String(profile.id),name:clean(profile.display_name||profile.email||"Usuário")} ]));}
  function rolesMap(roles={}){return roles instanceof Map?roles:new Map(Object.entries(roles||{}).map(([id,role])=>[String(id),clean(role||"member")]));}
  function normalizedCapacity(value){const source=value&&typeof value==="object"?value:{},fallback={max_actions:4,max_minutes:120};const item=(candidate,base=fallback)=>({max_actions:Math.max(1,Number(candidate?.max_actions||base.max_actions)),max_minutes:Math.max(15,Number(candidate?.max_minutes||base.max_minutes))});return {default:item(source.default),roles:Object.fromEntries(Object.entries(source.roles||{}).map(([role,entry])=>[role,item(entry)])),users:Object.fromEntries(Object.entries(source.users||{}).map(([id,entry])=>[id,item(entry)]))};}
  function capacityFor(userId,role,capacity){return capacity.users[userId]||capacity.roles[role]||capacity.default;}
  function localDay(value){const date=new Date(value);if(Number.isNaN(date.getTime()))return "";return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;}
  function addDays(day,amount){const date=new Date(`${day}T12:00:00`);date.setDate(date.getDate()+amount);return localDay(date);}
  function businessDays(start,count=7){const days=[];for(let offset=0;days.length<count&&offset<20;offset++){const day=addDays(start,offset),date=new Date(`${day}T12:00:00`);if(![0,6].includes(date.getDay()))days.push(day);}return days;}
  function makeSnapshotId(date=new Date()){const pad=value=>String(value).padStart(2,"0"),bytes=new Uint8Array(2);global.crypto.getRandomValues(bytes);return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}-${[...bytes].map(byte=>byte.toString(16).padStart(2,"0")).join("").toUpperCase()}`;}

  async function buildPortfolio({records=[],pendingItems=[],profiles=[],roles={},capacity={},workspaceId=null,now=new Date().toISOString()}={}){
    const people=profileMap(profiles),roleLookup=rolesMap(roles),pending=(pendingItems||[]).filter(item=>item?.status!=="completed").map(pendingSummary),pendingByRecord=new Map();
    for(const item of pending)if(item.linked_record_id){if(!pendingByRecord.has(item.linked_record_id))pendingByRecord.set(item.linked_record_id,[]);pendingByRecord.get(item.linked_record_id).push(item);}
    const entities=(records||[]).map(record=>{const ids=ownerIds(record);return {entity_type:entityType(record),entity_id:String(record.id),display_name:clean([record.first_name,record.last_name].filter(Boolean).join(" "))||"Sem nome",pipeline:clean(record.pipeline||"lead"),stage:clean(record.stage||"")||null,owner_ids:ids,owners:ids.map(id=>({id,name:people.get(id)?.name||"Responsável",role:roleLookup.get(id)||"member"})),last_activity_at:record.last_contact_at||record.whatsapp_transcript_updated_at||record.updated_at||null,next_action_at:record.next_action||null,current_commitments:appointments(record),analysis:analysisSummary(record),open_pendings:pendingByRecord.get(String(record.id))||[]};});
    for(const item of pending.filter(entry=>!entry.linked_record_id))entities.push({entity_type:"pending",entity_id:item.id,display_name:item.title,pipeline:"support",stage:item.status,owner_ids:item.owner_ids,owners:item.owner_ids.map(id=>({id,name:people.get(id)?.name||"Responsável",role:roleLookup.get(id)||"member"})),last_activity_at:null,next_action_at:item.due_at,current_commitments:[],analysis:{status:"not_applicable",updated_at:null,conversation_hash:null,analyzed_until_message_id:null,verdict:null,full_analysis:null,recommended_next_actions:[]},open_pendings:[item]});
    const team=(profiles||[]).map(profile=>{const id=String(profile.id),role=roleLookup.get(id)||"member";return {user_id:id,display_name:clean(profile.display_name||profile.email||"Usuário"),role,capacity:capacityFor(id,role,normalizedCapacity(capacity))};});
    const snapshotCore={as_of:now,workspace_id:workspaceId||null,team,entities};const portfolioHash=await sha256({workspace_id:snapshotCore.workspace_id,team,entities}),snapshotId=makeSnapshotId(new Date(now));
    return {schema_version:INPUT_SCHEMA,prompt_version:PROMPT_VERSION,snapshot_id:snapshotId,portfolio_hash:portfolioHash,generated_at:now,expected_output_filename:`04-IMPORTAR-NO-CRM_PLANO-DE-TRABALHO_${snapshotId}.zip`,scope:{includes:["leads","closed_clients","partners","open_pendings"],entity_count:entities.length,team_count:team.length},...snapshotCore};
  }

  function outputSchema(snapshot={}){return {schema_version:OUTPUT_SCHEMA,prompt_version:PROMPT_VERSION,snapshot_id:snapshot.snapshot_id||"SNAPSHOT_ID",portfolio_hash:snapshot.portfolio_hash||"PORTFOLIO_HASH",generated_at:"ISO_DATETIME",analysis_model:"ChatGPT",portfolio_summary:"síntese gerencial da carteira",actions:[{entity_type:"lead|closed|partner|pending",entity_id:"ID_EXATO_DO_ITEM",owner_id:"ID_EXATO_DO_RESPONSAVEL_OU_NULL",priority:"critical|high|medium|low",time_horizon:"today|week|waiting",action:"ação concreta",reason:"por que esta ação merece prioridade na carteira",estimated_minutes:20,suggested_message:"mensagem opcional de WhatsApp",suggested_speech:"orientação opcional para ligação ou conversa",depends_on:"dependência opcional",evidence:["fato curto presente no pacote"]}],coverage:{reviewed_entity_ids:["TODOS_OS_IDS_REVISADOS"],not_actionable:[{entity_type:"lead",entity_id:"ID",reason:"motivo factual"}]}};}
  function instructions(snapshot={}){return `# Planejamento gerencial da carteira — Criare\n\nSnapshot: ${snapshot.snapshot_id}\nHash: ${snapshot.portfolio_hash}\n\nAnalise a carteira inteira e compare os itens entre si. Esta etapa não substitui a análise individual: ela transforma análises, etapas, pendências, compromissos e capacidade em uma agenda de trabalho priorizada para cada responsável.\n\nInclua leads, clientes fechados, parceiros e pendências. Para cada entidade, decida se há ação executável hoje, nesta semana, ou se deve permanecer aguardando uma dependência. Preserve entity_type, entity_id e owner_id exatamente. Nunca transfira uma ação para outro responsável sem evidência; use owner_id null quando for necessária distribuição gerencial.\n\nA prioridade deve refletir risco comercial ou operacional, promessa vencida, cliente aguardando, oportunidade concreta, etapa, tempo parado e impacto relativo dentro da carteira. Não transforme todos os contatos em urgentes. Não invente conversas, prazos, valores, disponibilidade ou fatos.\n\nPara cada ação, informe duração estimada e uma justificativa gerencial. suggested_message e suggested_speech são opcionais e nunca serão enviados automaticamente. Itens sem análise suficiente devem aparecer em not_actionable ou gerar uma ação de obter contexto, nunca uma conclusão inventada.\n\nRevise todos os IDs recebidos e devolva um único ZIP chamado ${snapshot.expected_output_filename}, contendo management_plan.json na raiz e seguindo management_plan_output_schema.json.`;}
  function readme(snapshot={}){return `PLANO DE TRABALHO GERENCIAL — CRIARE\n\n1. Envie este ZIP ao GPT personalizado da Criare.\n2. Peça que siga management_plan_instructions.md.\n3. Importe no CRM o ZIP ${snapshot.expected_output_filename}.\n\nO pacote usa análises e dados gerenciais já salvos. Não contém o texto integral das conversas. Nenhuma mensagem ou compromisso externo será criado automaticamente.`;}
  function packageFiles(snapshot){return {"management_portfolio.json":JSON.stringify(snapshot,null,2),"management_plan_instructions.md":instructions(snapshot),"management_plan_output_schema.json":JSON.stringify(outputSchema(snapshot),null,2),"README.txt":readme(snapshot)};}
  function inputFilename(snapshotId){return `03-ENVIAR-AO-GPT_PLANO-DE-TRABALHO_${snapshotId}.zip`;}

  function validateResult(payload,snapshot){
    const errors=[];
    if(!payload||typeof payload!=="object")return {valid:false,errors:["Resultado ausente ou inválido."],actions:[]};
    if(payload.schema_version!==OUTPUT_SCHEMA)errors.push("Schema do plano gerencial incompatível.");
    if(payload.prompt_version!==PROMPT_VERSION)errors.push("Versão das instruções incompatível.");
    if(payload.snapshot_id!==snapshot?.snapshot_id)errors.push("O resultado pertence a outro snapshot.");
    if(payload.portfolio_hash!==snapshot?.portfolio_hash)errors.push("A carteira mudou desde a exportação; gere um novo plano.");

    const entities=new Map((snapshot?.entities||[]).map(entity=>[`${entity.entity_type}:${entity.entity_id}`,entity]));
    const entityIds=new Set((snapshot?.entities||[]).map(entity=>String(entity.entity_id)));
    const team=new Set((snapshot?.team||[]).map(person=>String(person.user_id)));
    const seen=new Set(),actedEntities=new Set(),actions=[];
    for(const [index,raw] of (Array.isArray(payload.actions)?payload.actions:[]).entries()){
      const itemErrors=[],entityType=clean(raw?.entity_type),entityId=clean(raw?.entity_id),key=`${entityType}:${entityId}`,entity=entities.get(key),priority=clean(raw?.priority).toLowerCase(),horizon=clean(raw?.time_horizon).toLowerCase(),action=clean(raw?.action),ownerId=raw?.owner_id?clean(raw.owner_id):null;
      if(!ENTITY_TYPES.has(entityType))itemErrors.push("tipo inválido");
      if(!entity)itemErrors.push("cadastro inexistente no snapshot");
      if(!PRIORITIES.has(priority))itemErrors.push("prioridade inválida");
      if(!HORIZONS.has(horizon))itemErrors.push("horizonte inválido");
      if(!action)itemErrors.push("ação vazia");
      if(ownerId&&!team.has(ownerId))itemErrors.push("responsável inexistente");
      if(ownerId&&entity?.owner_ids?.length&&!entity.owner_ids.map(String).includes(ownerId))itemErrors.push("responsável não pertence a este cadastro");
      const dedupe=`${key}:${ownerId||"unassigned"}:${action.toLowerCase()}`;
      if(seen.has(dedupe))itemErrors.push("ação duplicada");
      seen.add(dedupe);
      if(entity)actedEntities.add(key);
      const minutes=Math.max(5,Math.min(240,Number(raw?.estimated_minutes||20)));
      actions.push({index,valid:!itemErrors.length,errors:itemErrors,entity_type:entityType,entity_id:entityId,owner_id:ownerId,priority,time_horizon:horizon,action,reason:clean(raw?.reason),estimated_minutes:minutes,suggested_message:clean(raw?.suggested_message)||null,suggested_speech:clean(raw?.suggested_speech)||null,depends_on:clean(raw?.depends_on)||null,evidence:Array.isArray(raw?.evidence)?raw.evidence.map(clean).filter(Boolean).slice(0,10):[],action_key:dedupe});
    }
    if(!Array.isArray(payload.actions))errors.push("O resultado não contém actions.");
    for(const action of actions.filter(item=>!item.valid))errors.push(`Ação ${action.index+1}: ${action.errors.join(", ")}.`);

    const coverage=payload.coverage&&typeof payload.coverage==="object"?payload.coverage:{};
    const reviewedIds=new Set((Array.isArray(coverage.reviewed_entity_ids)?coverage.reviewed_entity_ids:[]).map(String));
    const notActionableKeys=new Set();
    for(const [index,item] of (Array.isArray(coverage.not_actionable)?coverage.not_actionable:[]).entries()){
      const key=`${clean(item?.entity_type)}:${clean(item?.entity_id)}`;
      if(!entities.has(key))errors.push(`Cobertura sem ação ${index+1}: cadastro inexistente no snapshot.`);
      else if(!clean(item?.reason))errors.push(`Cobertura sem ação ${index+1}: motivo vazio.`);
      else notActionableKeys.add(key);
    }
    const missingReview=[...entityIds].filter(id=>!reviewedIds.has(id));
    if(missingReview.length)errors.push(`Cobertura incompleta: ${missingReview.length} cadastro(s) não foram revisados.`);
    const unexplained=[...entities.keys()].filter(key=>!actedEntities.has(key)&&!notActionableKeys.has(key));
    if(unexplained.length)errors.push(`Cobertura incompleta: ${unexplained.length} cadastro(s) ficaram sem ação ou justificativa.`);
    return {valid:!errors.length,errors,actions,portfolio_summary:cleanMultiline(payload.portfolio_summary||"")||null,coverage};
  }

  function allocateActions(actions=[],snapshot={},existingItems=[],now=new Date().toISOString()){
    const capacity=normalizedCapacity({default:{max_actions:4,max_minutes:120},roles:Object.fromEntries((snapshot.team||[]).map(person=>[person.role,person.capacity]))}),team=new Map((snapshot.team||[]).map(person=>[String(person.user_id),person])),today=localDay(now),days=businessDays(today,7),usage=new Map(),reserve=(owner,day,minutes)=>{const key=`${owner}|${day}`,current=usage.get(key)||{count:0,minutes:0};usage.set(key,{count:current.count+1,minutes:current.minutes+minutes});};
    for(const entity of snapshot.entities||[])for(const item of entity.current_commitments||[]){const owner=entity.owner_ids?.[0],day=localDay(item.starts_at);if(owner&&day)reserve(owner,day,Number(item.duration_minutes||30));}
    for(const item of existingItems||[]){if(!["suggested","accepted"].includes(item.status)||!item.owner_id||!item.planned_date)continue;reserve(String(item.owner_id),String(item.planned_date),Number(item.estimated_minutes||20));}
    const sorted=actions.filter(item=>item.valid!==false).slice().sort((a,b)=>PRIORITY_WEIGHT[b.priority]-PRIORITY_WEIGHT[a.priority]||({today:0,week:1,waiting:2}[a.time_horizon]-{today:0,week:1,waiting:2}[b.time_horizon])||a.index-b.index),planned=[];
    for(const action of sorted){if(!action.owner_id||action.time_horizon==="waiting"){planned.push({...action,bucket:"waiting",planned_date:null,status:"suggested"});continue;}const person=team.get(String(action.owner_id)),limit=person?.capacity||capacityFor(String(action.owner_id),person?.role||"member",capacity),candidateDays=action.time_horizon==="today"?[days[0],...days.slice(1)]:days.slice(1),selected=candidateDays.find(day=>{const used=usage.get(`${action.owner_id}|${day}`)||{count:0,minutes:0};return used.count<limit.max_actions&&used.minutes+action.estimated_minutes<=limit.max_minutes;});if(selected){reserve(action.owner_id,selected,action.estimated_minutes);planned.push({...action,bucket:selected===days[0]?"today":"week",planned_date:selected,status:"suggested"});}else planned.push({...action,bucket:"backlog",planned_date:null,status:"suggested"});}
    return planned;
  }

  async function readResultZip(arrayBuffer){const bytes=new Uint8Array(arrayBuffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),read16=offset=>view.getUint16(offset,true),read32=offset=>view.getUint32(offset,true);let end=-1;for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)if(read32(offset)===0x06054b50){end=offset;break;}if(end<0)throw new Error("ZIP de plano inválido.");let offset=read32(end+16);const count=read16(end+10),decoder=new TextDecoder();for(let index=0;index<count;index++){if(read32(offset)!==0x02014b50)throw new Error("Diretório do ZIP inválido.");const method=read16(offset+10),compressedSize=read32(offset+20),uncompressedSize=read32(offset+24),nameSize=read16(offset+28),extraSize=read16(offset+30),commentSize=read16(offset+32),local=read32(offset+42),name=decoder.decode(bytes.slice(offset+46,offset+46+nameSize));if(read32(local)!==0x04034b50)throw new Error("Entrada do ZIP inválida.");const localName=read16(local+26),localExtra=read16(local+28);let content=bytes.slice(local+30+localName+localExtra,local+30+localName+localExtra+compressedSize);if(method===8){if(!global.DecompressionStream)throw new Error("Este navegador não consegue abrir ZIP compactado.");content=new Uint8Array(await new Response(new Blob([content]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());}else if(method!==0)throw new Error(`Compactação ZIP não suportada: ${method}.`);if(content.length!==uncompressedSize)throw new Error(`Tamanho inválido em ${name}.`);if(/(^|\/)management_plan\.json$/i.test(name))return JSON.parse(decoder.decode(content));offset+=46+nameSize+extraSize+commentSize;}throw new Error("O ZIP não contém management_plan.json.");}

  global.CriareManagementPlanning={version:MODULE_VERSION,inputSchema:INPUT_SCHEMA,outputSchemaVersion:OUTPUT_SCHEMA,promptVersion:PROMPT_VERSION,buildPortfolio,outputSchema,instructions,packageFiles,inputFilename,validateResult,allocateActions,readResultZip,clean,sha256};
})(typeof globalThis!=="undefined"?globalThis:this);
