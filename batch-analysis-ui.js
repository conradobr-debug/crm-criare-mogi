(function(){
  "use strict";
  if(window.__criareBatchAnalysisUiLoaded)return;
  window.__criareBatchAnalysisUiLoaded=true;

  const CRM_BATCH_VERSION="2.3.2";
  const engine=window.CriareBatchAnalysis;
  const state={candidates:[],selected:new Set(),cancelled:false,lastBatch:null,importPayload:null,importFile:null,validation:null,importResults:[],importMachine:engine.createImportStateMachine(),importPhase:"idle",actualWrites:0};
  const statusLabels={ready_to_import:"Pronta",invalid_schema:"Schema incompatível",duplicate:"Duplicada — não importada",duplicate_conflict:"Conflito de duplicidade",lead_not_found:"Lead não encontrado",invalid_analysis:"Análise inválida",stale_conversation:"Conversa alterada",already_imported:"Já importada",imported:"Importada",save_error:"Erro ao salvar"};

  function setPanel(id,titleId,statusId,title,message,kind=""){
    const panel=$(id); if(!panel)return;
    panel.classList.toggle("isError",kind==="error");panel.classList.toggle("isSuccess",kind==="success");
    $(titleId).textContent=title;$(statusId).textContent=message;
  }
  function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function fileStamp(){const d=new Date(),pad=value=>String(value).padStart(2,"0");return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;}
  function hasConversation(record){return engine.canonicalMessages(record).length>0;}
  function lastMessageDate(record){const value=engine.lastMessageTimestamp(record);const date=value?new Date(value):null;return date&&!Number.isNaN(date.getTime())?date:null;}
  function commitmentsFor(record){
    const stored=Array.isArray(record.appointments)?record.appointments.filter(item=>item?.starts_at).map(item=>({starts_at:item.starts_at,kind:item.kind||"Follow-up",details:item.details||null,status:item.status||"scheduled"})):[];
    if(stored.length)return stored;
    const legacy=getLegacyNextActionAt(record);
    return legacy?[{starts_at:legacy.toISOString(),kind:record.next_action_kind||"Follow-up",details:record.next_action_details||null,status:"scheduled"}]:[];
  }
  function contextFor(record){return {full_name:fullName(record),seller:profileNameById(record.owner_id),workspace_id:record.workspace_id||session?.user?.app_metadata?.workspace_id||null,commitments:commitmentsFor(record)};}
  function filterCandidates(){
    const scope=$("batchExportScope").value,owner=$("batchExportOwner").value,stage=$("batchExportStage").value,from=$("batchExportDateFrom").value,to=$("batchExportDateTo").value;
    const includeClosed=$("batchExportClosed").checked,includeLost=$("batchExportLost").checked;
    return records.filter(record=>{
      if(isSpecifier(record)||!hasConversation(record))return false;
      if(record.pipeline==="closed"&&!includeClosed)return false;
      if(record.stage==="Perdido"&&!includeLost)return false;
      if(!includeClosed&&!includeLost&&!(record.pipeline==="lead"&&record.stage!=="Perdido"))return false;
      if(owner&&String(record.owner_id||"")!==owner)return false;
      if(stage&&String(record.stage||"")!==stage)return false;
      const date=lastMessageDate(record);
      if(from&&(!date||date<new Date(`${from}T00:00:00`)))return false;
      if(to&&(!date||date>new Date(`${to}T23:59:59.999`)))return false;
      if(scope==="pending"&&record.whatsapp_analysis_status==="current")return false;
      return true;
    });
  }
  function populateExportFilters(){
    const owner=$("batchExportOwner"),stage=$("batchExportStage");
    owner.innerHTML='<option value="">Todos</option>'+profiles.map(profile=>`<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.display_name||profile.email||profile.id)}</option>`).join("");
    const stages=[...new Set(records.filter(record=>!isSpecifier(record)).map(record=>record.stage).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    stage.innerHTML='<option value="">Todas</option>'+stages.map(value=>`<option>${escapeHtml(value)}</option>`).join("");
  }
  function refreshExportPicker(resetSelection=false){
    state.candidates=filterCandidates();
    const ids=new Set(state.candidates.map(record=>String(record.id)));
    if(resetSelection)state.selected=new Set(ids);else state.selected=new Set([...state.selected].filter(id=>ids.has(id)));
    if(!state.selected.size&&state.candidates.length)state.selected=new Set(ids);
    $("batchExportLeadPicker").innerHTML=state.candidates.length?state.candidates.map(record=>{const date=lastMessageDate(record);return `<label class="batchLeadRow"><input type="checkbox" data-batch-lead="${escapeHtml(record.id)}" ${state.selected.has(String(record.id))?"checked":""}/><b>${escapeHtml(fullName(record))}</b><span>${escapeHtml(profileNameById(record.owner_id))}</span><span>${escapeHtml(record.stage||"—")}</span><small>${date?escapeHtml(fmtBRDateTime(date.toISOString())):"Sem data"}</small></label>`;}).join(""):'<div class="empty">Nenhuma conversa corresponde aos filtros.</div>';
    setPanel("batchExportPanel","batchExportCount","batchExportStatus",`${state.selected.size} conversa(s) selecionada(s)`,state.candidates.length?"Confira a seleção ou gere o pacote.":"Ajuste os filtros para localizar conversas capturadas.");
    $("btnGenerateBatchZip").disabled=!state.selected.size;
  }
  async function buildSelectedBatch(){
    const selected=state.candidates.filter(record=>state.selected.has(String(record.id)));
    if(!selected.length)throw new Error("Selecione ao menos uma conversa.");
    return engine.buildBatch(selected,contextFor);
  }
  async function exportBatch(){
    const button=$("btnGenerateBatchZip"),original=button.textContent;
    state.cancelled=false;button.disabled=true;button.textContent="Preparando…";
    setPanel("batchExportPanel","batchExportCount","batchExportStatus",`Preparando ${state.selected.size} conversa(s)`,"Montando mensagens canônicas e hashes determinísticos.");
    try{
      const batch=await buildSelectedBatch();if(state.cancelled)return;
      state.lastBatch=batch;
      const zip=engine.zipFiles(engine.packageFiles(batch)),input=engine.inputFilename(batch.batch_id),output=engine.outputFilename(batch.batch_id);downloadBlob(new Blob([zip],{type:"application/zip"}),input);setPanel("batchExportPanel","batchExportCount","batchExportStatus",`Arquivo criado: ${input}`,`Próximo passo: envie este ZIP ao GPT personalizado. Não tente importá-lo no CRM. Depois, o GPT deverá devolver: ${output}`,"success");
    }catch(error){setPanel("batchExportPanel","batchExportCount","batchExportStatus","Não foi possível gerar o pacote",error.message||String(error),"error");}
    finally{button.disabled=false;button.textContent=original;}
  }

  function hashLabel(result){if(result.status==="stale_conversation")return "Divergente";if(["ready_to_import","already_imported","imported","save_error"].includes(result.status))return "Exato";return "Não validado";}
  function analysisSnapshot(result){const current=result.record?.whatsapp_analysis_status||"never";return `${current} → ${result.status}`;}
  function renderSelectedFile(classification){
    const meta=state.importFile||{},batchId=classification?.batch_id||state.importPayload?.batch_id||"Não informado (schema 1.0)",count=classification?.analysis_count??(Array.isArray(state.importPayload?.analyses)?state.importPayload.analyses.length:0);
    $("batchSelectedFile").hidden=false;$("batchSelectedFile").innerHTML=`<b>Arquivo:</b> ${escapeHtml(meta.name||"JSON colado")}<br/><b>Tipo:</b> ${escapeHtml(meta.type||"application/json")}<br/><b>batch_id:</b> ${escapeHtml(batchId)}<br/><b>Análises:</b> ${escapeHtml(count)}<br/><b>Classificação:</b> ${escapeHtml(classification?.label||"Arquivo incompatível")}`;
  }
  function rejectWrongInput(classification){state.importPayload=null;state.validation=null;state.importPhase="error";state.actualWrites=0;renderSelectedFile(classification);$("batchImportPreview").innerHTML='<tr><td colspan="9">O arquivo selecionado não é um resultado de análise.</td></tr>';$("btnImportValidatedBatch").hidden=true;$("btnImportValidatedBatch").disabled=true;$("btnLoadAnotherBatch").hidden=false;setPanel("batchImportPanel","batchImportTitle","batchImportStatus","Este é o arquivo de conversas enviado ao GPT, não o resultado da análise.","Envie esse arquivo ao seu GPT e depois importe aqui o arquivo cujo nome começa com 02-IMPORTAR-NO-CRM.","error");}
  function renderImportPreview(){
    const results=state.validation?.results||[];
    $("batchImportPreview").innerHTML=results.length?results.map(result=>{const item=result.item||{},record=result.record;return `<tr><td><b>${escapeHtml(record?fullName(record):result.lead_id||"—")}</b><br/><small>${escapeHtml(result.lead_id||"—")}</small></td><td>${escapeHtml(record?profileNameById(record.owner_id):"—")}</td><td>${escapeHtml(record?.stage||"—")}</td><td>${escapeHtml(hashLabel(result))}</td><td>${escapeHtml(analysisSnapshot(result))}</td><td>${escapeHtml(item.risk?.level||"—")}</td><td>${escapeHtml(item.risk?.urgency_score??"—")}</td><td>${escapeHtml(item.conversation_status?.waiting_for||"—")}</td><td class="batchStatus ${escapeHtml(result.status)}" title="${escapeHtml(result.reason)}">${escapeHtml(statusLabels[result.status]||result.status)}<br/><small>${escapeHtml(result.reason)}</small></td></tr>`;}).join(""):'<tr><td colspan="9">Nenhuma análise encontrada.</td></tr>';
    const counts=results.reduce((map,result)=>(map[result.status]=(map[result.status]||0)+1,map),{});const ready=counts.ready_to_import||0;const received=state.validation?.summary?.received??results.length;const unique=state.validation?.summary?.unique??ready;const duplicates=counts.duplicate||0;const conflicts=counts.duplicate_conflict||0;const already=counts.already_imported||0;const imported=counts.imported||0;
    const completed=state.importPhase==="completed"||state.importMachine.phase==="completed";
    $("btnImportValidatedBatch").disabled=!ready||state.importPhase!=="ready";$("btnImportValidatedBatch").hidden=completed;
    $("btnLoadAnotherBatch").hidden=!completed;
    const file=state.importFile?.name||"JSON colado",batch=state.importPayload?.batch_id||"schema 1.0";const title=completed?`Lote ${batch} • recebidas: ${received} • importadas: ${imported}`:`${ready} pronta(s) para importar • lote ${batch}`;
    const detail=`Arquivo: ${file} • únicas: ${unique} • duplicadas: ${duplicates} • conflitos: ${conflicts} • já importadas: ${already} • gravações: ${state.actualWrites}.`;
    setPanel("batchImportPanel","batchImportTitle","batchImportStatus",title,detail,(counts.save_error||conflicts)?"error":"success");
  }
  async function parseImportText(text,meta={name:"JSON colado",type:"application/json"}){
    state.importFile=meta;
    state.importPhase="validating";state.actualWrites=0;$("btnImportValidatedBatch").disabled=true;$("btnImportValidatedBatch").hidden=false;$("btnLoadAnotherBatch").hidden=true;
    setPanel("batchImportPanel","batchImportTitle","batchImportStatus","Validando arquivo","Conferindo schema, leads, hashes e conteúdo.");
    try{const payload=JSON.parse(text);const classification=engine.classifyImportPayload(payload,meta);state.importPayload=payload;renderSelectedFile(classification);if(classification.code==="input_payload")return rejectWrongInput(classification);if(classification.code!=="analysis_result"){state.validation=null;state.importPhase="error";$("batchImportPreview").innerHTML='<tr><td colspan="9">Arquivo incompatível.</td></tr>';$("btnImportValidatedBatch").hidden=true;$("btnLoadAnotherBatch").hidden=false;return setPanel("batchImportPanel","batchImportTitle","batchImportStatus",classification.label,classification.reason||"O conteúdo não corresponde ao resultado esperado do GPT.","error");}const validation=await engine.validateImport(payload,records);state.validation=validation;state.importResults=[];state.importMachine.load(payload,validation);state.importPhase=state.importMachine.phase;renderImportPreview();}
    catch(error){state.importPayload=null;state.validation=null;state.importPhase="error";renderSelectedFile({label:"JSON inválido",analysis_count:0});$("batchImportPreview").innerHTML='<tr><td colspan="9">JSON inválido.</td></tr>';$("btnImportValidatedBatch").hidden=true;$("btnLoadAnotherBatch").hidden=false;setPanel("batchImportPanel","batchImportTitle","batchImportStatus","JSON inválido",error.message||String(error),"error");}
  }
  function handleImportFile(file){const meta={name:file.name,type:file.type||(/\.zip$/i.test(file.name)?"application/zip":"application/json")};state.importFile=meta;if(/\.zip$/i.test(file.name)||meta.type.includes("zip")){const classification=engine.classifyImportPayload(null,meta);return rejectWrongInput(classification);}return file.text().then(text=>parseImportText(text,meta));}
  function verifySavedAnalysis(record,result,payload){const meta=record?.whatsapp_analysis_structured?.batch_metadata;return record?.whatsapp_analysis_status==="current"&&record?.whatsapp_analysis_hard_boss===engine.clean(result.item.chefe_duro)&&meta?.import_key===result.import_key&&meta?.conversation_hash===result.item.conversation_hash&&meta?.prompt_version===payload.prompt_version;}
  function replaceRecord(reloaded){const at=records.findIndex(record=>record.id===reloaded.id);if(at>=0)records[at]=reloaded;}
  function importValidated(){
    if(!["ready","importing"].includes(state.importMachine.phase))return Promise.resolve({blocked:true,phase:state.importMachine.phase});
    const button=$("btnImportValidatedBatch");button.disabled=true;button.textContent="Importando…";state.importPhase="importing";
    const operation=state.importMachine.run(async snapshot=>{
      const ready=[...new Map((snapshot.validation?.results||[]).filter(result=>result.status==="ready_to_import").map(result=>[result.import_key,result])).values()];state.importResults=[];state.actualWrites=0;
      for(let index=0;index<ready.length;index++){
        const result=ready[index];setPanel("batchImportPanel","batchImportTitle","batchImportStatus",`Importando ${index+1} de ${ready.length}`,fullName(result.record));
        try{
          const {data:fresh,error:freshError}=await sb.from(TBL_RECORDS).select("*").eq("id",result.record.id).single();if(freshError)throw freshError;
          if(engine.storedImportKeys(fresh).has(result.import_key)){replaceRecord(fresh);result.record=fresh;result.status="already_imported";result.reason="A chave já estava persistida; nenhuma gravação foi executada.";state.importResults.push(result);continue;}
          const recheck=await engine.validateImport({...snapshot.payload,analyses:[result.item]},[fresh]);if(recheck.results[0]?.status!=="ready_to_import"){result.status=recheck.results[0]?.status||"save_error";result.reason=recheck.results[0]?.reason||"A validação antes da gravação falhou.";state.importResults.push(result);continue;}
          const patch=engine.persistencePatch(fresh,result.item,snapshot.payload,nowISO());
          const {error}=await sb.from(TBL_RECORDS).update(patch).eq("id",fresh.id);if(error)throw error;state.actualWrites+=1;
          const {data:reloaded,error:reloadError}=await sb.from(TBL_RECORDS).select("*").eq("id",fresh.id).single();if(reloadError)throw reloadError;
          if(!verifySavedAnalysis(reloaded,result,snapshot.payload))throw new Error("A confirmação após a gravação não corresponde à chave importada.");
          replaceRecord(reloaded);result.record=reloaded;result.status="imported";result.reason="Uma gravação executada e confirmada após releitura.";
        }catch(error){result.status="save_error";result.reason=error.message||String(error);}
        state.importResults.push(result);
      }
      return {writes:state.actualWrites,results:state.importResults};
    });
    return operation.then(result=>{if(!result?.blocked){state.importPhase="completed";button.textContent="Importar análises válidas";$("btnDownloadBatchFailures").hidden=!(state.validation?.results||[]).some(item=>!["imported","already_imported","duplicate"].includes(item.status));renderImportPreview();}return result;}).catch(error=>{state.importPhase="error";button.textContent="Importar análises válidas";setPanel("batchImportPanel","batchImportTitle","batchImportStatus","Falha na importação",error.message||String(error),"error");return {error};});
  }
  function loadAnotherImport(){if(!state.importMachine.reset())return;state.importPhase="idle";state.importPayload=null;state.importFile=null;state.validation=null;state.importResults=[];state.actualWrites=0;$("batchImportPaste").value="";$("batchSelectedFile").hidden=true;$("batchSelectedFile").textContent="";$("batchImportPreview").innerHTML='<tr><td colspan="9">Aguardando JSON.</td></tr>';$("btnImportValidatedBatch").hidden=false;$("btnImportValidatedBatch").disabled=true;$("btnLoadAnotherBatch").hidden=true;$("btnDownloadBatchFailures").hidden=true;setPanel("batchImportPanel","batchImportTitle","batchImportStatus","Nenhum arquivo validado","Selecione, arraste ou cole um novo JSON retornado pelo GPT.");}
  async function copyGptInstruction(){const input=state.lastBatch?engine.inputFilename(state.lastBatch.batch_id):"o arquivo que começa com 01-ENVIAR-AO-GPT",output=state.lastBatch?engine.outputFilename(state.lastBatch.batch_id):"um arquivo que começa com 02-IMPORTAR-NO-CRM";const message=`Analise o pacote ${input} seguindo integralmente as instruções internas. Devolva somente o resultado como arquivo JSON baixável chamado exatamente ${output}. Não devolva batch_input.json e não use nome genérico.`;try{await navigator.clipboard.writeText(message);toast("Instrução para o GPT copiada.");}catch(error){toast("Não foi possível copiar a instrução.",{error:true});}}
  function downloadFailures(){const failures=(state.validation?.results||[]).filter(result=>!['imported','already_imported'].includes(result.status)).map(result=>({lead_id:result.lead_id,status:result.status,reason:result.reason,analysis:result.item||null}));downloadBlob(new Blob([JSON.stringify({crm_version:CRM_BATCH_VERSION,generated_at:nowISO(),failures},null,2)],{type:"application/json"}),`criare-batch-import-falhas-${fileStamp()}.json`);}

  window.wireBatchAnalysisReport=function(){
    const exportButton=$("btnOpenBatchExport"),importButton=$("btnOpenBatchImport"),copyButton=$("btnCopyBatchGptInstruction");
    if(exportButton&&!exportButton.dataset.batchWired){exportButton.dataset.batchWired="1";exportButton.addEventListener("click",()=>{populateExportFilters();refreshExportPicker(true);$("batchExportModal").showModal();});}
    if(importButton&&!importButton.dataset.batchWired){importButton.dataset.batchWired="1";importButton.addEventListener("click",()=>{$("batchImportModal").showModal();});}
    if(copyButton&&!copyButton.dataset.batchWired){copyButton.dataset.batchWired="1";copyButton.addEventListener("click",copyGptInstruction);}
  };

  if(window.__criareBatchAnalysisStaticListenersRegistered)return;
  window.__criareBatchAnalysisStaticListenersRegistered=true;
  ["batchExportScope","batchExportOwner","batchExportStage","batchExportDateFrom","batchExportDateTo","batchExportClosed","batchExportLost"].forEach(id=>$(id).addEventListener("change",()=>refreshExportPicker(true)));
  $("batchExportLeadPicker").addEventListener("change",event=>{const input=event.target.closest("[data-batch-lead]");if(!input)return;input.checked?state.selected.add(input.dataset.batchLead):state.selected.delete(input.dataset.batchLead);setPanel("batchExportPanel","batchExportCount","batchExportStatus",`${state.selected.size} conversa(s) selecionada(s)`,"Confira a seleção ou gere o pacote.");$("btnGenerateBatchZip").disabled=!state.selected.size;});
  $("btnGenerateBatchZip").addEventListener("click",exportBatch);
  $("btnCancelBatchExport").addEventListener("click",()=>{state.cancelled=true;$("batchExportModal").close();});$("btnCloseBatchExport").addEventListener("click",()=>$("batchExportModal").close());
  $("btnCloseBatchImport").addEventListener("click",()=>$("batchImportModal").close());$("btnChooseBatchImport").addEventListener("click",()=>$("batchImportFile").click());
  $("batchImportFile").addEventListener("change",event=>{const file=event.target.files?.[0];if(file)handleImportFile(file);event.target.value="";});
  $("btnPreviewBatchPaste").addEventListener("click",()=>parseImportText($("batchImportPaste").value,{name:"JSON colado",type:"application/json"}));
  const drop=$("batchImportDropZone");drop.addEventListener("click",()=>$("batchImportFile").click());drop.addEventListener("dragover",event=>{event.preventDefault();drop.classList.add("dragging");});drop.addEventListener("dragleave",()=>drop.classList.remove("dragging"));drop.addEventListener("drop",event=>{event.preventDefault();drop.classList.remove("dragging");const file=[...event.dataTransfer.files].find(item=>/\.(json|zip)$/i.test(item.name));if(file)handleImportFile(file);else setPanel("batchImportPanel","batchImportTitle","batchImportStatus","Arquivo não reconhecido","Use o JSON que começa com 02-IMPORTAR-NO-CRM.","error");});
  $("btnImportValidatedBatch").addEventListener("click",importValidated);$("btnLoadAnotherBatch").addEventListener("click",loadAnotherImport);$("btnDownloadBatchFailures").addEventListener("click",downloadFailures);
})();
