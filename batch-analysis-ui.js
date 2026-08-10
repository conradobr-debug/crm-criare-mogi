(function(){
  "use strict";
  if(window.__criareBatchAnalysisUiLoaded)return;
  window.__criareBatchAnalysisUiLoaded=true;

  const CRM_BATCH_VERSION="2.9.6";
  const CANDIDATE_TABLE="crm_whatsapp_lead_candidates";
  const engine=window.CriareBatchAnalysis;
  const syncEngine=window.CriareWhatsAppSyncReceipt;
  const state={candidates:[],selected:new Set(),cancelled:false,lastBatch:null,importPayload:null,importFile:null,validation:null,importResults:[],importMachine:engine.createImportStateMachine(),importPhase:"idle",actualWrites:0,receiptPlan:null,receiptApplied:false,leadCandidates:[],dismissedCandidates:[],candidateInboxMode:"pending",linkingCandidateId:null,workspaceRoles:{}};
  const statusLabels={ready_to_import:"Pronta",invalid_schema:"Schema incompatível",duplicate:"Duplicada — não importada",duplicate_conflict:"Conflito de duplicidade",conversation_identity_conflict:"Conversa associada a mais de um cadastro",lead_not_found:"Lead não encontrado",invalid_analysis:"Análise inválida",stale_conversation:"Conversa alterada",already_imported:"Já importada",imported:"Importada",save_error:"Erro ao salvar"};

  function setPanel(id,titleId,statusId,title,message,kind=""){
    const panel=$(id); if(!panel)return;
    panel.classList.toggle("isError",kind==="error");panel.classList.toggle("isSuccess",kind==="success");
    $(titleId).textContent=title;$(statusId).textContent=message;
  }
  function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function fileStamp(){const d=new Date(),pad=value=>String(value).padStart(2,"0");return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;}
  function hasUsablePhone(record){try{return typeof phoneIdentityState==="function"&&phoneIdentityState(record).ready;}catch(error){return Boolean(String(record?.phone||"").replace(/\D/g,""));}}
  function lastMessageDate(record){const value=engine.lastMessageTimestamp(record)||record?.whatsapp_analysis_updated_at||record?.whatsapp_summary_updated_at;const date=value?new Date(value):null;return date&&!Number.isNaN(date.getTime())?date:null;}
  function commitmentsFor(record){
    const stored=Array.isArray(record.appointments)?record.appointments.filter(item=>item?.starts_at).map(item=>({starts_at:item.starts_at,kind:item.kind||"Follow-up",details:item.details||null,status:item.status||"scheduled"})):[];
    if(stored.length)return stored;
    const legacy=getLegacyNextActionAt(record);
    return legacy?[{starts_at:legacy.toISOString(),kind:record.next_action_kind||"Follow-up",details:record.next_action_details||null,status:"scheduled"}]:[];
  }
  function phoneDigits(value){return String(value||"").replace(/\D/g,"");}
  function contextFor(record){
    const phone=phoneDigits(record.phone),openPending=(typeof pendingItems!=="undefined"?pendingItems:[]).filter(item=>item.status!=="completed"&&phone&&phoneDigits(item.customer_phone)===phone);
    const analysisFocus=record?.record_type==="pending_contact"||openPending.length?"technical_support":(record?.record_type==="specifier"?"partner_relationship":(record.pipeline==="closed"?"post_sale":"sales"));
    return {full_name:fullName(record),seller:profileNameById(record.owner_id),workspace_id:record.workspace_id||session?.user?.app_metadata?.workspace_id||null,commitments:commitmentsFor(record),identity_status:typeof phoneIdentityState==="function"?phoneIdentityState(record).code:"ready",analysis_focus:analysisFocus,open_pending_context:openPending.map(item=>({id:item.id,type:item.pending_type,title:item.title,priority:item.priority,due_at:item.due_at||null,description:item.description||null}))};
  }
  function currentWorkspaceId(){return records.find(record=>record?.workspace_id)?.workspace_id||session?.user?.app_metadata?.workspace_id||"00000000-0000-4000-8000-000000000001";}
  async function loadWorkspaceRoles(){const {data,error}=await sb.from(TBL_WORKSPACE_MEMBERS).select("user_id,role").eq("workspace_id",currentWorkspaceId());if(error)throw error;state.workspaceRoles=Object.fromEntries((data||[]).map(item=>[String(item.user_id),String(item.role||"member")]));return state.workspaceRoles;}
  function selectedCompleteness(){const selected=state.candidates.filter(record=>state.selected.has(String(record.id)));return selected.map(record=>({record,summary:window.CriareConversationCompleteness.calculate(record,{identity_status:typeof phoneIdentityState==="function"?phoneIdentityState(record).code:"ready"})}));}
  function completenessStatus(summary){if(summary.conversation_completeness_status==="complete")return "Completa";if(summary.metadata_pending_audio_count)return "Metadados pendentes";return ({pending_audio:"Áudios pendentes",unavailable_audio:"Mídia indisponível",capture_may_be_incomplete:"Captura potencialmente incompleta",verification_required:"Verificação necessária",not_captured:"Não capturada"})[summary.conversation_completeness_status]||summary.conversation_completeness_status;}
  function refreshCompletenessWarning(){const chosen=selectedCompleteness(),incomplete=chosen.filter(item=>item.summary.conversation_completeness_status!=="complete"),withPending=chosen.filter(item=>item.summary.pending_audio_count>0),withMetadata=chosen.filter(item=>item.summary.metadata_pending_audio_count>0),capture=chosen.filter(item=>item.summary.capture_may_be_incomplete),unavailable=chosen.filter(item=>item.summary.unavailable_audio_count>0),complete=chosen.filter(item=>item.summary.conversation_completeness_status==="complete"),pending=withPending.reduce((sum,item)=>sum+item.summary.pending_audio_count,0),box=$("batchCompletenessChoice");if(!box)return;box.hidden=!incomplete.length;$("batchCompletenessWarning").innerHTML=`Das ${chosen.length} conversas selecionadas:<br>• ${withPending.length} possuem áudios sem transcrição (${pending} áudio(s));<br>• ${withMetadata.length} possuem metadados de áudio não confirmados;<br>• ${capture.length} possuem captura potencialmente incompleta;<br>• ${unavailable.length} possuem mídia indisponível;<br>• ${complete.length} não possuem pendências conhecidas.`;if(!incomplete.length)box.querySelectorAll("input").forEach(input=>input.checked=false);}
  function filterCandidates(){
    const scope=$("batchExportScope").value,owner=$("batchExportOwner").value,stage=$("batchExportStage").value,from=$("batchExportDateFrom").value,to=$("batchExportDateTo").value;
    const includeClosed=$("batchExportClosed").checked,includeLost=$("batchExportLost").checked,includePartners=$("batchExportPartners").checked,includePending=$("batchExportPending").checked;
    return records.filter(record=>{
      if(!hasUsablePhone(record))return false;
      if(isSpecifier(record) && !includePartners)return false;
      if(typeof isPendingContact==="function"&&isPendingContact(record) && !includePending)return false;
      if(!isSpecifier(record)&&!(typeof isPendingContact==="function"&&isPendingContact(record))){
        if(record.pipeline==="closed"&&!includeClosed)return false;
        if(record.stage==="Perdido"&&!includeLost)return false;
        if(!includeClosed&&!includeLost&&!(record.pipeline==="lead"&&record.stage!=="Perdido"))return false;
      }
      if(owner&&String(record.owner_id||"")!==owner)return false;
      if(stage&&String(record.stage||"")!==stage)return false;
      const date=lastMessageDate(record);
      if(from&&(!date||date<new Date(`${from}T00:00:00`)))return false;
      if(to&&(!date||date>new Date(`${to}T23:59:59.999`)))return false;
      if(scope!=="full_history_reanalysis"&&!engine.shouldQueueWhatsAppVerification(record,scope))return false;
      return true;
    });
  }
  function populateExportFilters(){
    const owner=$("batchExportOwner"),stage=$("batchExportStage");
    owner.innerHTML='<option value="">Todos</option>'+profiles.map(profile=>`<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.display_name||profile.email||profile.id)}</option>`).join("");
    const stages=[...new Set(records.map(record=>record.stage).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    stage.innerHTML='<option value="">Todas</option>'+stages.map(value=>`<option>${escapeHtml(value)}</option>`).join("");
  }
  function refreshExportPicker(resetSelection=false){
    state.candidates=filterCandidates();
    const ids=new Set(state.candidates.map(record=>String(record.id)));
    if(resetSelection)state.selected=new Set(ids);else state.selected=new Set([...state.selected].filter(id=>ids.has(id)));
    if(!state.selected.size&&state.candidates.length)state.selected=new Set(ids);
    $("batchExportLeadPicker").innerHTML=state.candidates.length?state.candidates.map(record=>{const partial=Boolean(record.whatsapp_analysis_last_message_id),verification=engine.whatsappVerificationState(record),checked=verification.checked_at?new Date(verification.checked_at).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):"nunca",audience=typeof recordAudienceLabel==="function"?recordAudienceLabel(record):(record.pipeline==="closed"?"Fechado":"Lead");return `<label class="batchLeadRow"><input type="checkbox" data-batch-lead="${escapeHtml(record.id)}" ${state.selected.has(String(record.id))?"checked":""}/><b>${escapeHtml(fullName(record))}<small>${escapeHtml(audience)} • ${partial?"Parcial desde a última análise":"Histórico completo"} • ${escapeHtml(verification.label)} • conferida: ${escapeHtml(checked)}</small></b><span>${escapeHtml(profileNameById(record.owner_id))}</span><span>${escapeHtml(record.stage||"—")}</span><small>${escapeHtml(record.phone||"Sem telefone")}</small></label>`;}).join(""):'<div class="empty">Nenhum contato precisa de verificação neste filtro.</div>';
    setPanel("batchExportPanel","batchExportCount","batchExportStatus",`${state.selected.size} contato(s) selecionado(s)`,state.candidates.length?"A extensão fará uma conferência leve e baixará somente as conversas alteradas.":"Tudo está atualizado neste filtro.");
    $("btnGenerateBatchZip").disabled=!state.selected.size;
    $("batchCompletenessChoice").hidden=true;
  }
  async function buildSelectedBatch(selection=null){
    const selected=selection||state.candidates.filter(record=>state.selected.has(String(record.id)));
    if(!selected.length)throw new Error("Selecione ao menos uma conversa.");
    return engine.buildDownloadRequest(selected,contextFor,records.filter(record=>hasUsablePhone(record)),{force_full_history:$("batchExportScope").value==="full_history_reanalysis"});
  }
  async function exportBatch(){
    const button=$("btnGenerateBatchZip"),original=button.textContent;
    state.cancelled=false;button.disabled=true;button.textContent="Preparando…";
    const fullHistory=$("batchExportScope").value==="full_history_reanalysis";
    setPanel("batchExportPanel","batchExportCount","batchExportStatus",`Preparando ${state.selected.size} contato(s)`,fullHistory?"Montando uma fila de reanálise completa, sem usar o cursor da última análise.":"Montando uma fila leve, sem conversas ou mídias.");
    try{
      const batch=await buildSelectedBatch();if(state.cancelled)return;
      state.lastBatch=batch;
      const filename=engine.downloadRequestFilename(batch.batch_id);downloadBlob(new Blob([JSON.stringify(batch,null,2)],{type:"application/json"}),filename);setPanel("batchExportPanel","batchExportCount","batchExportStatus",`Fila criada: ${filename}`,`Próximo passo: abra o WhatsApp Web, carregue esta fila na extensão e aguarde o pacote ${batch.expected_input_filename}.`,"success");
    }catch(error){setPanel("batchExportPanel","batchExportCount","batchExportStatus","Não foi possível gerar o pacote",error.message||String(error),"error");}
    finally{button.disabled=false;button.textContent=original;}
  }

  function hashLabel(result){if(result.status==="stale_conversation")return "Divergente";if(["ready_to_import","already_imported","imported","save_error"].includes(result.status))return "Exato";return "Não validado";}
  function analysisSnapshot(result){const current=result.record?.whatsapp_analysis_status||"never";return `${current} → ${result.status}`;}
  function renderSelectedFile(classification){
    const meta=state.importFile||{},filenameBatchId=String(meta.name||"").match(/\d{8}-\d{4}-[A-F0-9]{4}/i)?.[0]?.toUpperCase(),batchId=classification?.batch_id||state.importPayload?.batch_id||filenameBatchId||"Não informado (schema 1.0)",count=classification?.analysis_count??(Array.isArray(state.importPayload?.analyses)?state.importPayload.analyses.length:0);
    $("batchSelectedFile").hidden=false;$("batchSelectedFile").innerHTML=`<b>Arquivo:</b> ${escapeHtml(meta.name||"JSON colado")}<br/><b>Tipo:</b> ${escapeHtml(meta.type||"application/json")}<br/><b>batch_id:</b> ${escapeHtml(batchId)}<br/><b>Análises:</b> ${escapeHtml(count)}<br/><b>Classificação:</b> ${escapeHtml(classification?.label||"Arquivo incompatível")}`;
  }
  function rejectWrongInput(classification){state.importPayload=null;state.validation=null;state.importPhase="error";state.actualWrites=0;renderSelectedFile(classification);$("batchImportPreview").innerHTML='<tr><td colspan="9">O arquivo selecionado não é um resultado de análise.</td></tr>';$("btnImportValidatedBatch").hidden=true;$("btnImportValidatedBatch").disabled=true;$("btnLoadAnotherBatch").hidden=false;setPanel("batchImportPanel","batchImportTitle","batchImportStatus","Este é o arquivo de conversas enviado ao GPT, não o resultado da análise.","Envie esse arquivo ao seu GPT e depois importe aqui o arquivo cujo nome começa com 02-IMPORTAR-NO-CRM.","error");}
  function renderImportPreview(){
    const results=state.validation?.results||[];
    $("batchImportPreview").innerHTML=results.length?results.map(result=>{const item=result.item||{},record=result.record;return `<tr><td><b>${escapeHtml(record?fullName(record):result.lead_id||"—")}</b><br/><small>${escapeHtml(result.lead_id||"—")}</small></td><td>${escapeHtml(record?profileNameById(record.owner_id):"—")}</td><td>${escapeHtml(record?.stage||"—")}</td><td>${escapeHtml(hashLabel(result))}</td><td>${escapeHtml(analysisSnapshot(result))}</td><td>${escapeHtml(item.risk?.level||"—")}</td><td>${escapeHtml(item.risk?.urgency_score??"—")}</td><td>${escapeHtml(item.conversation_status?.waiting_for||"—")}</td><td class="batchStatus ${escapeHtml(result.status)}" title="${escapeHtml(result.reason)}">${escapeHtml(statusLabels[result.status]||result.status)}<br/><small>${escapeHtml(result.reason)}</small></td></tr>`;}).join(""):'<tr><td colspan="9">Nenhuma análise encontrada.</td></tr>';
    const counts=results.reduce((map,result)=>(map[result.status]=(map[result.status]||0)+1,map),{});const ready=counts.ready_to_import||0;const received=state.validation?.summary?.received??results.length;const unique=state.validation?.summary?.unique??ready;const duplicates=counts.duplicate||0;const conflicts=counts.duplicate_conflict||0;const already=counts.already_imported||0;const imported=counts.imported||0;const suggested=results.reduce((sum,result)=>sum+Number(result.action_plan?.suggested||0),0);const deferred=results.reduce((sum,result)=>sum+Number(result.action_plan?.deferred||0),0);
    const completed=state.importPhase==="completed"||state.importMachine.phase==="completed";
    $("btnImportValidatedBatch").disabled=!ready||state.importPhase!=="ready";$("btnImportValidatedBatch").hidden=completed;
    $("btnLoadAnotherBatch").hidden=!completed;
    const file=state.importFile?.name||"JSON colado",batch=state.importPayload?.batch_id||"schema 1.0";const title=completed?`Lote ${batch} • recebidas: ${received} • importadas: ${imported}`:`${ready} pronta(s) para importar • lote ${batch}`;
    const identityConflicts=counts.conversation_identity_conflict||0;const detail=`Arquivo: ${file} • únicas: ${unique} • duplicadas: ${duplicates} • conflitos: ${conflicts} • vínculos ambíguos: ${identityConflicts} • já importadas: ${already} • gravações: ${state.actualWrites} • sugestões IA: ${suggested}${deferred?` • adiadas por capacidade: ${deferred}`:""}.`;
    setPanel("batchImportPanel","batchImportTitle","batchImportStatus",title,detail,(counts.save_error||conflicts||identityConflicts)?"error":"success");
  }
  async function parseImportText(text,meta={name:"JSON colado",type:"application/json"}){
    state.importFile=meta;
    state.importPhase="validating";state.actualWrites=0;$("btnImportValidatedBatch").disabled=true;$("btnImportValidatedBatch").hidden=false;$("btnLoadAnotherBatch").hidden=true;
    setPanel("batchImportPanel","batchImportTitle","batchImportStatus","Validando arquivo","Conferindo schema, leads, hashes e conteúdo.");
    try{const payload=JSON.parse(text);const classification=engine.classifyImportPayload(payload,meta);state.importPayload=payload;renderSelectedFile(classification);if(classification.code==="input_payload")return rejectWrongInput(classification);if(classification.code!=="analysis_result"){state.validation=null;state.importPhase="error";$("batchImportPreview").innerHTML='<tr><td colspan="9">Arquivo incompatível.</td></tr>';$("btnImportValidatedBatch").hidden=true;$("btnLoadAnotherBatch").hidden=false;return setPanel("batchImportPanel","batchImportTitle","batchImportStatus",classification.label,classification.reason||"O conteúdo não corresponde ao resultado esperado do GPT.","error");}const validation=await engine.validateImport(payload,records);state.validation=validation;state.importResults=[];state.importMachine.load(payload,validation);state.importPhase=state.importMachine.phase;renderImportPreview();}
    catch(error){state.importPayload=null;state.validation=null;state.importPhase="error";renderSelectedFile({label:"JSON inválido",analysis_count:0});$("batchImportPreview").innerHTML='<tr><td colspan="9">JSON inválido.</td></tr>';$("btnImportValidatedBatch").hidden=true;$("btnLoadAnotherBatch").hidden=false;setPanel("batchImportPanel","batchImportTitle","batchImportStatus","JSON inválido",error.message||String(error),"error");}
  }
  async function handleImportFile(file){const meta={name:file.name,type:file.type||(/\.zip$/i.test(file.name)?"application/zip":"application/json")};state.importFile=meta;if(/\.zip$/i.test(file.name)||meta.type.includes("zip")){try{const payload=await engine.readResultZip(await file.arrayBuffer());return parseImportText(JSON.stringify(payload),meta);}catch(error){state.importPhase="error";return setPanel("batchImportPanel","batchImportTitle","batchImportStatus","ZIP incompatível",error.message||String(error),"error");}}return file.text().then(text=>parseImportText(text,meta));}
  function verifySavedAnalysis(record,result,payload){const meta=record?.whatsapp_analysis_structured?.batch_metadata;return record?.whatsapp_analysis_status==="current"&&record?.whatsapp_analysis_hard_boss===engine.clean(result.item.chefe_duro)&&meta?.import_key===result.import_key&&meta?.conversation_hash===result.item.conversation_hash&&meta?.prompt_version===payload.prompt_version;}
  function replaceRecord(reloaded){const at=records.findIndex(record=>record.id===reloaded.id);if(at>=0)records[at]=reloaded;}
  function importValidated(){
    if(!["ready","importing"].includes(state.importMachine.phase))return Promise.resolve({blocked:true,phase:state.importMachine.phase});
    const button=$("btnImportValidatedBatch");button.disabled=true;button.textContent="Importando…";state.importPhase="importing";
    const operation=state.importMachine.run(async snapshot=>{
      const ready=[...new Map((snapshot.validation?.results||[]).filter(result=>result.status==="ready_to_import").map(result=>[result.import_key,result])).values()];state.importResults=[];state.actualWrites=0;let rolesByUser={};try{rolesByUser=await loadWorkspaceRoles();}catch(error){rolesByUser=Object.fromEntries((profiles||[]).map(profile=>[String(profile.id),"member"]));console.warn("[CRM IA] Funções indisponíveis; aplicado limite padrão por responsável.",error);}const actionPlan=engine.planDailyActionSuggestions(ready,records,{now:nowISO(),capacity:config?.ai_daily_action_capacity,rolesByUser});
      for(let index=0;index<ready.length;index++){
        const result=ready[index];setPanel("batchImportPanel","batchImportTitle","batchImportStatus",`Importando ${index+1} de ${ready.length}`,fullName(result.record));
        try{
          const {data:fresh,error:freshError}=await sb.from(TBL_RECORDS).select("*").eq("id",result.record.id).single();if(freshError)throw freshError;
          if(engine.storedImportKeys(fresh).has(result.import_key)){replaceRecord(fresh);result.record=fresh;result.status="already_imported";result.reason="A chave já estava persistida; nenhuma gravação foi executada.";state.importResults.push(result);continue;}
          const recheck=await engine.validateImport({...snapshot.payload,analyses:[result.item]},[fresh]);if(recheck.results[0]?.status!=="ready_to_import"){result.status=recheck.results[0]?.status||"save_error";result.reason=recheck.results[0]?.reason||"A validação antes da gravação falhou.";state.importResults.push(result);continue;}
          const suggestions=actionPlan.by_record.get(String(fresh.id))||[];const deferred=actionPlan.skipped.filter(item=>item.lead_id===String(fresh.id)).length;const patch=engine.persistencePatch(fresh,result.item,snapshot.payload,nowISO(),suggestions);
          const {error}=await sb.from(TBL_RECORDS).update(patch).eq("id",fresh.id);if(error)throw error;state.actualWrites+=1;
          const {data:reloaded,error:reloadError}=await sb.from(TBL_RECORDS).select("*").eq("id",fresh.id).single();if(reloadError)throw reloadError;
          if(!verifySavedAnalysis(reloaded,result,snapshot.payload))throw new Error("A confirmação após a gravação não corresponde à chave importada.");
          replaceRecord(reloaded);result.record=reloaded;result.status="imported";result.action_plan={suggested:suggestions.length,deferred};result.reason=`Uma gravação executada e confirmada após releitura.${suggestions.length?` ${suggestions.length} sugestão(ões) da IA incluída(s) para revisão.`:""}${deferred?` ${deferred} ação(ões) adiada(s) por capacidade ou responsável.`:""}`;
        }catch(error){result.status="save_error";result.reason=error.message||String(error);}
        state.importResults.push(result);
      }
      return {writes:state.actualWrites,results:state.importResults};
    });
    return operation.then(result=>{if(!result?.blocked){state.importPhase="completed";button.textContent="Importar análises válidas";$("btnDownloadBatchFailures").hidden=!(state.validation?.results||[]).some(item=>!["imported","already_imported","duplicate"].includes(item.status));renderImportPreview();}return result;}).catch(error=>{state.importPhase="error";button.textContent="Importar análises válidas";setPanel("batchImportPanel","batchImportTitle","batchImportStatus","Falha na importação",error.message||String(error),"error");return {error};});
  }
  function loadAnotherImport(){if(!state.importMachine.reset())return;state.importPhase="idle";state.importPayload=null;state.importFile=null;state.validation=null;state.importResults=[];state.actualWrites=0;$("batchImportPaste").value="";$("batchSelectedFile").hidden=true;$("batchSelectedFile").textContent="";$("batchImportPreview").innerHTML='<tr><td colspan="9">Aguardando JSON.</td></tr>';$("btnImportValidatedBatch").hidden=false;$("btnImportValidatedBatch").disabled=true;$("btnLoadAnotherBatch").hidden=true;$("btnDownloadBatchFailures").hidden=true;setPanel("batchImportPanel","batchImportTitle","batchImportStatus","Nenhum arquivo validado","Selecione, arraste ou cole um novo JSON retornado pelo GPT.");}
  async function copyGptInstruction(){const input=state.lastBatch?.expected_input_filename||"o arquivo que começa com 01-ENVIAR-AO-GPT",output=state.lastBatch?.expected_output_filename||"um ZIP que começa com 02-IMPORTAR-NO-CRM";const message=`Analise o pacote ${input} seguindo integralmente as instruções internas. Leia também as mídias disponíveis nas pastas de cada cliente. Devolva somente o ZIP ${output}, com um resultado.json dentro da pasta de cada cliente e o result_manifest.json na raiz. Cada resultado deve conter apenas Chefe Duro, Análise Completa e os identificadores exigidos.`;try{await navigator.clipboard.writeText(message);toast("Instrução para o GPT copiada.");}catch(error){toast("Não foi possível copiar a instrução.",{error:true});}}
  function downloadFailures(){const failures=(state.validation?.results||[]).filter(result=>!['imported','already_imported'].includes(result.status)).map(result=>({lead_id:result.lead_id,status:result.status,reason:result.reason,analysis:result.item||null}));downloadBlob(new Blob([JSON.stringify({crm_version:CRM_BATCH_VERSION,generated_at:nowISO(),failures},null,2)],{type:"application/json"}),`criare-batch-import-falhas-${fileStamp()}.json`);}

  function renderReceiptPlan(){
    const plan=state.receiptPlan,container=$("extensionReceiptDiscoveries");if(!plan){container.innerHTML="";return;}
    const candidates=plan.discoveries.filter(item=>item.classification!=="known_contact");
    container.innerHTML=candidates.length?`<h3>Conversas recentes para revisar</h3><p>Ao confirmar, estas conversas ficarão guardadas em <b>Novos no WhatsApp</b>, mesmo depois de fechar esta janela.</p><div class="whatsappCandidateList">${candidates.map(item=>{const chat=item.chat;return `<div class="whatsappCandidateRow"><div class="whatsappCandidateIdentity"><b>${escapeHtml(chat.display_name||"Sem nome")}</b><small>${escapeHtml(chat.phone_e164||chat.contact_wa_id||chat.external_chat_id||"Sem telefone confirmado")}</small></div><span class="whatsappCandidateMeta">${escapeHtml(chat.last_message_at?fmtBRDateTime(chat.last_message_at):"Data não disponível")}</span><span>${item.classification==="ambiguous"?"Telefone ambíguo":"Possível novo lead"}</span><span>Será salvo para revisão</span></div>`;}).join("")}</div>`:'<div class="empty">Nenhuma conversa nova encontrada na varredura recente.</div>';
  }

  function currentCandidateInbox(){return state.candidateInboxMode==="dismissed"?state.dismissedCandidates:state.leadCandidates;}
  function updateCandidateBadge(){const count=state.leadCandidates.length,badge=$("whatsappCandidateCount");if(!badge)return;badge.textContent=String(count);badge.hidden=!count;}
  function renderCandidateInbox(){
    const list=$("whatsappCandidateList"),showingDismissed=state.candidateInboxMode==="dismissed",candidates=currentCandidateInbox();if(!list)return;
    list.innerHTML=candidates.length?candidates.map(candidate=>`<div class="whatsappCandidateRow" data-whatsapp-candidate="${escapeHtml(candidate.id)}"><div class="whatsappCandidateIdentity"><b>${escapeHtml(candidate.display_name||"Contato sem nome")}</b><small>${escapeHtml(candidate.phone_e164||candidate.contact_wa_id||candidate.external_chat_id)}</small>${candidate.phone_e164?"":'<small class="candidatePhoneFlag">Telefone não confirmado — será solicitado no cadastro</small>'}${candidate.matched_pending_id?'<small class="candidatePendingFlag">Pendência criada — finalize o vínculo para incluir a conversa na análise</small>':""}</div><span class="whatsappCandidateMeta">Última atividade<br>${escapeHtml(candidate.last_message_at?fmtBRDateTime(candidate.last_message_at):"data não disponível")}</span><div class="whatsappCandidateActions">${showingDismissed?`<button class="primary" data-candidate-reactivate="${escapeHtml(candidate.id)}">Reativar para classificação</button>`:`<button class="primary" data-candidate-lead="${escapeHtml(candidate.id)}">Novo lead</button><button class="ghost" data-candidate-closed="${escapeHtml(candidate.id)}">Fechado / pós-venda</button><button class="ghost" data-candidate-link="${escapeHtml(candidate.id)}">Vincular existente</button>${candidate.matched_pending_id?`<button class="ghost" data-candidate-resolve-pending="${escapeHtml(candidate.id)}">Vincular à pendência</button>`:`<button class="ghost" data-candidate-pending="${escapeHtml(candidate.id)}">Criar pendência</button>`}<button class="dangerGhost" data-candidate-dismiss="${escapeHtml(candidate.id)}">Ignorar</button>`}</div></div>`).join(""):`<div class="empty">${showingDismissed?"Nenhum contato ignorado para revisar.":"Nenhum contato do WhatsApp aguardando classificação."}</div>`;
    setPanel("whatsappCandidatesPanel","whatsappCandidatesTitle","whatsappCandidatesStatus",showingDismissed?`${state.dismissedCandidates.length} contato(s) ignorado(s)`: `${state.leadCandidates.length} contato(s) aguardando classificação`,showingDismissed?"Reative somente os contatos que voltaram a ser relevantes. Eles retornarão à caixa de classificação.":(state.leadCandidates.length?"Escolha o destino correto de cada conversa. Nada será criado sem sua confirmação.":"A caixa está em dia."),"success");
    const toggle=$("btnToggleDismissedWhatsAppCandidates");if(toggle){toggle.textContent=showingDismissed?"Voltar aos pendentes":`Ver ignorados${state.dismissedCandidates.length?` (${state.dismissedCandidates.length})`:""}`;toggle.disabled=!showingDismissed&&!state.dismissedCandidates.length;}updateCandidateBadge();
  }
  async function refreshCandidateInbox({silent=false}={}){
    if(!isAdminUser()||!sb||!session?.user)return;
    if(!silent)setPanel("whatsappCandidatesPanel","whatsappCandidatesTitle","whatsappCandidatesStatus","Carregando candidatos","Buscando conversas recentes ainda sem vínculo.");
    const {data,error}=await sb.from(CANDIDATE_TABLE).select("*").eq("workspace_id",currentWorkspaceId()).in("status",["pending","dismissed"]).order("last_message_at",{ascending:false,nullsFirst:false});
    if(error){state.leadCandidates=[];state.dismissedCandidates=[];updateCandidateBadge();if(!silent)setPanel("whatsappCandidatesPanel","whatsappCandidatesTitle","whatsappCandidatesStatus","Não foi possível abrir a caixa",error.message||String(error),"error");return;}
    state.leadCandidates=(data||[]).filter(item=>item.status==="pending");state.dismissedCandidates=(data||[]).filter(item=>item.status==="dismissed");renderCandidateInbox();
  }
  function openCandidateAsRecord(candidate,pipeline="lead"){
    const name=String(candidate.display_name||"").trim(),parts=name&&!/^\+?\d/.test(name)?name.split(/\s+/):["Novo","contato"];
    const sourceAvailable=[...$("source").options].some(option=>option.value==="WhatsApp");
    openModal(null,{whatsappCandidateId:candidate.id,initialPipeline:pipeline,initialStage:pipeline==="closed"?"Contrato realizado":"Novo",prefill:{first_name:parts.shift()||"Novo",last_name:parts.join(" ")||"WhatsApp",phone:candidate.phone_e164||"",source:sourceAvailable?"WhatsApp":"",notes:pipeline==="closed"?`Cliente já fechado identificado no WhatsApp em ${candidate.last_message_at?fmtBRDateTime(candidate.last_message_at):"data não disponível"}. O acompanhamento desta conversa deve ser de pós-venda.`:`Detectado automaticamente no WhatsApp em ${candidate.last_message_at?fmtBRDateTime(candidate.last_message_at):"data não disponível"}.`}});renderPhoneIdentityStatus(null);if(!candidate.phone_e164){$("phone").focus();toast("Confirme o telefone deste contato antes de salvar. O WhatsApp forneceu apenas um identificador interno.");}
  }
  function openCandidateAsPending(candidate){
    openPendingModal(null,{whatsappCandidateId:candidate.id});
    $("pendingTitle").value=`WhatsApp — ${candidate.display_name||candidate.phone_e164||"contato a revisar"}`;
    $("pendingType").value="Assistência técnica";$("pendingCustomer").value=candidate.display_name||"";$("pendingPhone").value=candidate.phone_e164||"";
    $("pendingDescription").value=`Contato detectado no WhatsApp para assistência, garantia ou acompanhamento operacional. Conversa: ${candidate.external_chat_id}. Última atividade: ${candidate.last_message_at?fmtBRDateTime(candidate.last_message_at):"data não disponível"}.`;
  }
  function openCandidateLink(candidate){
    state.linkingCandidateId=candidate.id;$("whatsappCandidateLinkName").textContent=`Vincular ${candidate.display_name||candidate.phone_e164||"este contato"} a um cadastro já existente.`;
    const options=records.filter(record=>!(typeof isPendingContact==="function"&&isPendingContact(record))).sort((a,b)=>fullName(a).localeCompare(fullName(b),"pt-BR")).map(record=>`<option value="${escapeHtml(record.id)}">${escapeHtml(fullName(record))} — ${isSpecifier(record)?"Parceiro":(record.pipeline==="closed"?"Fechado / pós-venda":"Lead comercial")}${record.phone?` — ${escapeHtml(record.phone)}`:""}</option>`).join("");
    $("whatsappCandidateRecordSelect").innerHTML=options||'<option value="">Nenhum cadastro disponível</option>';$("btnConfirmWhatsAppCandidateLink").disabled=!options;$("whatsappCandidateLinkModal").showModal();
  }
  async function confirmCandidateLink(){
    const candidate=state.leadCandidates.find(item=>item.id===state.linkingCandidateId),recordId=$("whatsappCandidateRecordSelect").value;if(!candidate||!recordId)return;
    const button=$("btnConfirmWhatsAppCandidateLink");button.disabled=true;button.textContent="Vinculando…";
    const {data,error}=await sb.from(TBL_RECORDS).update({whatsapp_external_chat_id:candidate.external_chat_id||null,whatsapp_observed_last_message_id:candidate.last_message_id||null,whatsapp_observed_last_message_at:candidate.last_message_at||null,whatsapp_last_checked_at:nowISO(),whatsapp_sync_status:"awaiting_analysis",whatsapp_analysis_status:"stale"}).eq("id",recordId).select("*").single();
    if(error){button.disabled=false;button.textContent="Confirmar vínculo";return toast("Não foi possível vincular esta conversa.",{error:true});}replaceRecord(data);
    if(candidate.matched_pending_id)await sb.from(TBL_PENDING).update({customer_name:fullName(data),customer_phone:data.phone||candidate.phone_e164||null}).eq("id",candidate.matched_pending_id);
    const {error:candidateError}=await sb.from(CANDIDATE_TABLE).update({status:"known",matched_record_id:recordId,updated_at:nowISO()}).eq("id",candidate.id);button.textContent="Confirmar vínculo";if(candidateError){button.disabled=false;return toast("O cliente foi vinculado, mas a caixa não pôde ser atualizada.",{error:true});}
    $("whatsappCandidateLinkModal").close();state.linkingCandidateId=null;await refreshCandidateInbox({silent:true});buildFilters();render();toast(isSpecifier(data)?"Parceiro vinculado. A próxima análise será de relacionamento.":(data.pipeline==="closed"?"Cliente vinculado. A próxima análise será de pós-venda.":"Lead vinculado à conversa do WhatsApp."));
  }
  async function dismissCandidate(id){const {error}=await sb.from(CANDIDATE_TABLE).update({status:"dismissed",updated_at:nowISO()}).eq("id",id);if(error)return toast("Não foi possível ignorar este contato.",{error:true});await refreshCandidateInbox({silent:true});}
  async function reactivateCandidate(id){const {error}=await sb.from(CANDIDATE_TABLE).update({status:"pending",updated_at:nowISO()}).eq("id",id);if(error)return toast("Não foi possível reativar este contato.",{error:true});state.candidateInboxMode="pending";await refreshCandidateInbox({silent:true});toast("Contato reativado para classificação.");}
  async function resolveCandidatePending(candidate){
    const pending=(typeof pendingItems!=="undefined"?pendingItems:[]).find(item=>item.id===candidate.matched_pending_id);
    if(!pending)return toast("A pendência associada não foi encontrada.",{error:true});
    const linked=await ensurePendingWhatsAppRecord(pending);
    if(!linked.record)return toast(linked.reason||"Informe um telefone válido para vincular esta pendência.",{error:true});
    const {error}=await sb.from(CANDIDATE_TABLE).update({status:"known",matched_record_id:linked.record.id,updated_at:nowISO()}).eq("id",candidate.id);
    if(error)return toast("A conversa foi vinculada, mas a caixa não pôde ser atualizada.",{error:true});
    await refreshCandidateInbox({silent:true});
    toast("Conversa vinculada à pendência para análise de assistência.");
  }
  async function onCandidateLeadCreated(candidateId,lead){
    const candidate=state.leadCandidates.find(item=>item.id===candidateId);if(!candidate)return;
    const {data,error}=await sb.from(TBL_RECORDS).update({whatsapp_external_chat_id:candidate.external_chat_id||null,whatsapp_observed_last_message_id:candidate.last_message_id||null,whatsapp_observed_last_message_at:candidate.last_message_at||null,whatsapp_last_checked_at:nowISO(),whatsapp_sync_status:"awaiting_analysis"}).eq("id",lead.id).select("*").single();if(error)throw error;replaceRecord(data);
    if(candidate.matched_pending_id)await sb.from(TBL_PENDING).update({customer_name:fullName(lead),customer_phone:lead.phone||candidate.phone_e164||null}).eq("id",candidate.matched_pending_id);
    const {error:candidateError}=await sb.from(CANDIDATE_TABLE).update({status:"converted",matched_record_id:lead.id,updated_at:nowISO()}).eq("id",candidateId);if(candidateError)throw candidateError;await refreshCandidateInbox({silent:true});toast(candidate.matched_pending_id?"Cliente vinculado à pendência. A análise será focada em assistência.":(lead.pipeline==="closed"?"Cliente fechado criado. A análise será focada em pós-venda.":"Lead criado e vinculado à conversa do WhatsApp."));
  }
  async function onCandidatePendingCreated(candidateId,pending){
    const linked=typeof pendingConversationRecord==="function"?pendingConversationRecord(pending):null;
    const patch={matched_pending_id:pending.id,updated_at:nowISO()};
    if(linked?.id){patch.status="known";patch.matched_record_id=linked.id;}
    const {error}=await sb.from(CANDIDATE_TABLE).update(patch).eq("id",candidateId);
    if(error)throw error;
    await refreshCandidateInbox({silent:true});
    toast(linked?.id?"Pendência criada e conversa vinculada para análise de assistência.":"Pendência criada. Informe um telefone válido ou vincule o contato para incluir a conversa na análise.");
  }
  async function loadExtensionReceipt(file){
    if(!isAdminUser())return toast("Apenas o administrador pode atualizar os controles de sincronização.",{error:true});
    try{
      const receipt=syncEngine.validate(JSON.parse(await file.text()));state.receiptPlan=syncEngine.receiptPlan(receipt,records);state.receiptApplied=false;
      const summary=state.receiptPlan.summary;
      setPanel("extensionReceiptPanel","extensionReceiptTitle","extensionReceiptStatus",`Retorno ${receipt.batch_id} validado`,`${summary.unchanged} atualizada(s), ${summary.processed} aguardando análise, ${summary.failures} falha(s), ${summary.possible_new} possível(is) novo(s) lead(s).`,summary.failures?"error":"success");
      $("btnApplyExtensionReceipt").disabled=!state.receiptPlan.patches.length&&!state.receiptPlan.discoveries.some(item=>item.classification!=="known_contact");renderReceiptPlan();
    }catch(error){state.receiptPlan=null;$("btnApplyExtensionReceipt").disabled=true;setPanel("extensionReceiptPanel","extensionReceiptTitle","extensionReceiptStatus","Retorno inválido",error.message||String(error),"error");renderReceiptPlan();}
  }
  async function applyExtensionReceipt(){
    if(!isAdminUser()||!state.receiptPlan||state.receiptApplied)return;
    const button=$("btnApplyExtensionReceipt");button.disabled=true;button.textContent="Atualizando lote…";
    const updates=state.receiptPlan.patches.map(item=>({id:item.record.id,...item.patch}));
    const candidateChats=state.receiptPlan.discoveries.filter(item=>item.classification!=="known_contact").map(item=>{
      const chat=item.chat||{};return {external_chat_id:chat.external_chat_id||null,contact_wa_id:chat.contact_wa_id||null,phone_e164:chat.phone_e164||null,display_name:chat.display_name||null,last_message_id:chat.last_message_id||null,last_message_at:chat.last_message_at||null};
    });
    const {data,error}=await sb.rpc("crm_apply_whatsapp_sync_receipt",{p_workspace_id:currentWorkspaceId(),p_batch_id:state.receiptPlan.receipt.batch_id,p_updates:updates,p_candidates:candidateChats});
    if(error){
      button.textContent="Tentar novamente";button.disabled=false;
      setPanel("extensionReceiptPanel","extensionReceiptTitle","extensionReceiptStatus","Atualização não concluída",`Nada novo foi enviado ao CRM. Detalhe: ${error.message||"erro no Supabase"}`,"error");
      return;
    }
    for(const item of state.receiptPlan.patches)replaceRecord({...item.record,...item.patch});
    await refreshCandidateInbox({silent:true});
    state.receiptApplied=true;button.textContent="Atualização concluída";button.disabled=true;
    setPanel("extensionReceiptPanel","extensionReceiptTitle","extensionReceiptStatus",`${Number(data?.updated||0)} controle(s) atualizado(s) • ${Number(data?.saved||0)} candidato(s) guardado(s)`,`Um único lote transacional foi concluído. Abra Novos no WhatsApp para cadastrar ou ignorar cada possível lead.`,"success");
    buildFilters();render();
  }

  window.wireBatchAnalysisReport=function(){
    const exportButton=$("btnOpenBatchExport"),importButton=$("btnOpenBatchImport"),copyButton=$("btnCopyBatchGptInstruction");
    if(exportButton&&!exportButton.dataset.batchWired){exportButton.dataset.batchWired="1";exportButton.addEventListener("click",()=>{if(!isAdminUser())return;populateExportFilters();refreshExportPicker(true);$("batchExportModal").showModal();});}
    if(importButton&&!importButton.dataset.batchWired){importButton.dataset.batchWired="1";importButton.addEventListener("click",()=>{if(isAdminUser())$("batchImportModal").showModal();});}
    if(copyButton&&!copyButton.dataset.batchWired){copyButton.dataset.batchWired="1";copyButton.addEventListener("click",copyGptInstruction);}
  };

  const headerExportButton=$("btnOpenBatchExportHeader");
  if(headerExportButton&&!headerExportButton.dataset.batchWired){headerExportButton.dataset.batchWired="1";headerExportButton.addEventListener("click",()=>{if(!isAdminUser())return;populateExportFilters();refreshExportPicker(true);$("batchExportModal").showModal();});}

  if(window.__criareBatchAnalysisStaticListenersRegistered)return;
  window.__criareBatchAnalysisStaticListenersRegistered=true;
  ["batchExportScope","batchExportOwner","batchExportStage","batchExportDateFrom","batchExportDateTo","batchExportClosed","batchExportLost","batchExportPartners","batchExportPending"].forEach(id=>$(id).addEventListener("change",()=>refreshExportPicker(true)));
  $("batchExportLeadPicker").addEventListener("change",event=>{const input=event.target.closest("[data-batch-lead]");if(!input)return;input.checked?state.selected.add(input.dataset.batchLead):state.selected.delete(input.dataset.batchLead);setPanel("batchExportPanel","batchExportCount","batchExportStatus",`${state.selected.size} contato(s) selecionado(s)`,"Confira a seleção e baixe a fila.");$("btnGenerateBatchZip").disabled=!state.selected.size;});
  $("btnGenerateBatchZip").addEventListener("click",exportBatch);
  window.CriareBatchAnalysisUI={openForRecords(ids=[],options={}){populateExportFilters();if(options.includePartners)$("batchExportPartners").checked=true;if(options.includePending)$("batchExportPending").checked=true;refreshExportPicker(true);if(ids.length)state.selected=new Set(ids.map(String));refreshExportPicker(false);$("batchExportModal").showModal();}};
  $("btnCancelBatchExport").addEventListener("click",()=>{state.cancelled=true;$("batchExportModal").close();});$("btnCloseBatchExport").addEventListener("click",()=>$("batchExportModal").close());
  $("btnCloseBatchImport").addEventListener("click",()=>$("batchImportModal").close());$("btnChooseBatchImport").addEventListener("click",()=>$("batchImportFile").click());
  $("batchImportFile").addEventListener("change",event=>{const file=event.target.files?.[0];if(file)handleImportFile(file);event.target.value="";});
  $("btnPreviewBatchPaste").addEventListener("click",()=>parseImportText($("batchImportPaste").value,{name:"JSON colado",type:"application/json"}));
  const drop=$("batchImportDropZone");drop.addEventListener("click",()=>$("batchImportFile").click());drop.addEventListener("dragover",event=>{event.preventDefault();drop.classList.add("dragging");});drop.addEventListener("dragleave",()=>drop.classList.remove("dragging"));drop.addEventListener("drop",event=>{event.preventDefault();drop.classList.remove("dragging");const file=[...event.dataTransfer.files].find(item=>/\.(json|zip)$/i.test(item.name));if(file)handleImportFile(file);else setPanel("batchImportPanel","batchImportTitle","batchImportStatus","Arquivo não reconhecido","Use o JSON que começa com 02-IMPORTAR-NO-CRM.","error");});
  $("btnImportValidatedBatch").addEventListener("click",importValidated);$("btnLoadAnotherBatch").addEventListener("click",loadAnotherImport);$("btnDownloadBatchFailures").addEventListener("click",downloadFailures);
  const receiptButton=$("btnImportExtensionReceipt");if(receiptButton)receiptButton.addEventListener("click",()=>{if(!isAdminUser())return;state.receiptPlan=null;state.receiptApplied=false;$("btnApplyExtensionReceipt").disabled=true;setPanel("extensionReceiptPanel","extensionReceiptTitle","extensionReceiptStatus","Nenhum retorno selecionado","Use o arquivo pequeno criado junto com o ZIP enviado ao GPT.");renderReceiptPlan();$("extensionReceiptModal").showModal();});
  const candidateButton=$("btnReviewWhatsAppCandidates");if(candidateButton)candidateButton.addEventListener("click",async()=>{if(!isAdminUser())return;state.candidateInboxMode="pending";$("whatsappCandidatesModal").showModal();await refreshCandidateInbox();});
  $("btnCloseWhatsAppCandidates").addEventListener("click",()=>$("whatsappCandidatesModal").close());
  $("btnRefreshWhatsAppCandidates").addEventListener("click",()=>refreshCandidateInbox());
  $("btnToggleDismissedWhatsAppCandidates").addEventListener("click",()=>{state.candidateInboxMode=state.candidateInboxMode==="dismissed"?"pending":"dismissed";renderCandidateInbox();});
  $("whatsappCandidateList").addEventListener("click",event=>{const button=event.target.closest("button");if(!button)return;const id=button.dataset.candidateLead||button.dataset.candidateClosed||button.dataset.candidateLink||button.dataset.candidatePending||button.dataset.candidateDismiss||button.dataset.candidateReactivate||button.dataset.candidateResolvePending,candidate=currentCandidateInbox().find(item=>item.id===id);if(!candidate)return;if(button.dataset.candidateLead){$("whatsappCandidatesModal").close();openCandidateAsRecord(candidate,"lead");}else if(button.dataset.candidateClosed){$("whatsappCandidatesModal").close();openCandidateAsRecord(candidate,"closed");}else if(button.dataset.candidateLink)openCandidateLink(candidate);else if(button.dataset.candidatePending){$("whatsappCandidatesModal").close();openCandidateAsPending(candidate);}else if(button.dataset.candidateDismiss)dismissCandidate(id);else if(button.dataset.candidateReactivate)reactivateCandidate(id);else if(button.dataset.candidateResolvePending)resolveCandidatePending(candidate).catch(error=>{console.error(error);toast("Não foi possível vincular a conversa à pendência.",{error:true});});});
  $("btnCloseWhatsAppCandidateLink").addEventListener("click",()=>$("whatsappCandidateLinkModal").close());$("btnCancelWhatsAppCandidateLink").addEventListener("click",()=>$("whatsappCandidateLinkModal").close());$("btnConfirmWhatsAppCandidateLink").addEventListener("click",confirmCandidateLink);
  $("btnCloseExtensionReceipt").addEventListener("click",()=>$("extensionReceiptModal").close());
  $("btnChooseExtensionReceipt").addEventListener("click",()=>$("extensionReceiptFile").click());
  $("extensionReceiptFile").addEventListener("change",event=>{const file=event.target.files?.[0];if(file)loadExtensionReceipt(file);event.target.value="";});
  $("btnApplyExtensionReceipt").addEventListener("click",applyExtensionReceipt);
  window.CriareWhatsAppLeadCandidates={onLeadCreated:onCandidateLeadCreated,onPendingCreated:onCandidatePendingCreated,refresh:refreshCandidateInbox};
  setTimeout(()=>refreshCandidateInbox({silent:true}),1500);
})();
