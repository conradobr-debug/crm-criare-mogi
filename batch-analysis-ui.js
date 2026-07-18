(function(){
  "use strict";

  const CRM_BATCH_VERSION="2.3.0";
  const engine=window.CriareBatchAnalysis;
  const state={candidates:[],selected:new Set(),cancelled:false,lastBatch:null,importPayload:null,validation:null,importResults:[]};
  const statusLabels={ready_to_import:"Pronta",invalid_schema:"Schema incompatível",duplicate:"Duplicada",lead_not_found:"Lead não encontrado",invalid_analysis:"Análise inválida",stale_conversation:"Conversa alterada",already_imported:"Já importada",imported:"Importada",save_error:"Erro ao salvar"};

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
    $("btnGenerateBatchZip").disabled=!state.selected.size;$("btnDownloadBatchJson").disabled=!state.selected.size;
  }
  async function buildSelectedBatch(){
    const selected=state.candidates.filter(record=>state.selected.has(String(record.id)));
    if(!selected.length)throw new Error("Selecione ao menos uma conversa.");
    return engine.buildBatch(selected,contextFor);
  }
  async function exportBatch(format){
    const button=format==="zip"?$("btnGenerateBatchZip"):$("btnDownloadBatchJson"),original=button.textContent;
    state.cancelled=false;button.disabled=true;button.textContent="Preparando…";
    setPanel("batchExportPanel","batchExportCount","batchExportStatus",`Preparando ${state.selected.size} conversa(s)`,"Montando mensagens canônicas e hashes determinísticos.");
    try{
      const batch=await buildSelectedBatch();if(state.cancelled)return;
      state.lastBatch=batch;
      if(format==="zip"){const zip=engine.zipFiles(engine.packageFiles(batch));downloadBlob(new Blob([zip],{type:"application/zip"}),`criare-batch-analysis-${fileStamp()}.zip`);}
      else downloadBlob(new Blob([JSON.stringify(batch,null,2)],{type:"application/json"}),"batch_input.json");
      setPanel("batchExportPanel","batchExportCount","batchExportStatus",`${batch.conversation_count} conversa(s) exportada(s)`,format==="zip"?"ZIP pronto para enviar ao GPT personalizado.":"JSON de entrada baixado.","success");
    }catch(error){setPanel("batchExportPanel","batchExportCount","batchExportStatus","Não foi possível gerar o pacote",error.message||String(error),"error");}
    finally{button.disabled=false;button.textContent=original;}
  }

  function hashLabel(result){if(result.status==="stale_conversation")return "Divergente";if(["ready_to_import","already_imported","imported","save_error"].includes(result.status))return "Exato";return "Não validado";}
  function analysisSnapshot(result){const current=result.record?.whatsapp_analysis_status||"never";return `${current} → ${result.status}`;}
  function renderImportPreview(){
    const results=state.validation?.results||[];
    $("batchImportPreview").innerHTML=results.length?results.map(result=>{const item=result.item||{},record=result.record;return `<tr><td><b>${escapeHtml(record?fullName(record):result.lead_id||"—")}</b><br/><small>${escapeHtml(result.lead_id||"—")}</small></td><td>${escapeHtml(record?profileNameById(record.owner_id):"—")}</td><td>${escapeHtml(record?.stage||"—")}</td><td>${escapeHtml(hashLabel(result))}</td><td>${escapeHtml(analysisSnapshot(result))}</td><td>${escapeHtml(item.risk?.level||"—")}</td><td>${escapeHtml(item.risk?.urgency_score??"—")}</td><td>${escapeHtml(item.conversation_status?.waiting_for||"—")}</td><td class="batchStatus ${escapeHtml(result.status)}" title="${escapeHtml(result.reason)}">${escapeHtml(statusLabels[result.status]||result.status)}<br/><small>${escapeHtml(result.reason)}</small></td></tr>`;}).join(""):'<tr><td colspan="9">Nenhuma análise encontrada.</td></tr>';
    const ready=results.filter(result=>result.status==="ready_to_import").length;
    $("btnImportValidatedBatch").disabled=!ready;
    setPanel("batchImportPanel","batchImportTitle","batchImportStatus",`${ready} pronta(s) para importar`,`${results.length-ready} item(ns) serão preservados sem gravação.`,ready?"success":"error");
  }
  async function parseImportText(text){
    setPanel("batchImportPanel","batchImportTitle","batchImportStatus","Validando arquivo","Conferindo schema, leads, hashes e conteúdo.");
    try{const payload=JSON.parse(text);state.importPayload=payload;state.validation=await engine.validateImport(payload,records);state.importResults=[];renderImportPreview();}
    catch(error){state.importPayload=null;state.validation=null;$("batchImportPreview").innerHTML='<tr><td colspan="9">JSON inválido.</td></tr>';$("btnImportValidatedBatch").disabled=true;setPanel("batchImportPanel","batchImportTitle","batchImportStatus","JSON inválido",error.message||String(error),"error");}
  }
  function verifySavedAnalysis(record,item,payload){const meta=record?.whatsapp_analysis_structured?.batch_metadata;return record?.whatsapp_analysis_status==="current"&&record?.whatsapp_analysis_hard_boss===engine.clean(item.chefe_duro)&&meta?.conversation_hash===item.conversation_hash&&meta?.prompt_version===payload.prompt_version;}
  async function importValidated(){
    const ready=(state.validation?.results||[]).filter(result=>result.status==="ready_to_import");if(!ready.length)return;
    const button=$("btnImportValidatedBatch"),original=button.textContent;button.disabled=true;button.textContent="Importando…";state.importResults=[];
    for(let index=0;index<ready.length;index++){
      const result=ready[index];setPanel("batchImportPanel","batchImportTitle","batchImportStatus",`Importando ${index+1} de ${ready.length}`,fullName(result.record));
      try{
        const patch=engine.persistencePatch(result.record,result.item,state.importPayload,nowISO());
        const {error}=await sb.from(TBL_RECORDS).update(patch).eq("id",result.record.id);if(error)throw error;
        const {data:reloaded,error:reloadError}=await sb.from(TBL_RECORDS).select("*").eq("id",result.record.id).single();if(reloadError)throw reloadError;
        if(!verifySavedAnalysis(reloaded,result.item,state.importPayload))throw new Error("A confirmação após a gravação não corresponde ao arquivo importado.");
        const at=records.findIndex(record=>record.id===reloaded.id);if(at>=0)records[at]=reloaded;
        result.status="imported";result.reason="Análise gravada e confirmada após releitura.";
      }catch(error){result.status="save_error";result.reason=error.message||String(error);}
      state.importResults.push(result);
    }
    const base=(state.validation?.results||[]).filter(result=>result.status!=="ready_to_import");state.validation.results=[...state.importResults,...base];
    renderImportPreview();
    const counts=state.validation.results.reduce((map,result)=>(map[result.status]=(map[result.status]||0)+1,map),{});
    const imported=counts.imported||0,invalid=(counts.invalid_analysis||0)+(counts.invalid_schema||0)+(counts.duplicate||0),failed=(counts.save_error||0)+invalid+(counts.lead_not_found||0)+(counts.stale_conversation||0);
    setPanel("batchImportPanel","batchImportTitle","batchImportStatus",`Recebidas: ${state.validation.results.length} • importadas: ${imported}`,`Desatualizadas: ${counts.stale_conversation||0} • inválidas: ${invalid} • lead não encontrado: ${counts.lead_not_found||0} • já importadas: ${counts.already_imported||0} • erros ao salvar: ${counts.save_error||0}.`,failed?"error":"success");
    $("btnDownloadBatchFailures").hidden=!state.validation.results.some(result=>!['imported','already_imported'].includes(result.status));button.textContent=original;button.disabled=true;
  }
  function downloadFailures(){const failures=(state.validation?.results||[]).filter(result=>!['imported','already_imported'].includes(result.status)).map(result=>({lead_id:result.lead_id,status:result.status,reason:result.reason,analysis:result.item||null}));downloadBlob(new Blob([JSON.stringify({crm_version:CRM_BATCH_VERSION,generated_at:nowISO(),failures},null,2)],{type:"application/json"}),`criare-batch-import-falhas-${fileStamp()}.json`);}

  window.wireBatchAnalysisReport=function(){
    $("btnOpenBatchExport")?.addEventListener("click",()=>{populateExportFilters();refreshExportPicker(true);$("batchExportModal").showModal();});
    $("btnOpenBatchImport")?.addEventListener("click",()=>{$("batchImportModal").showModal();});
  };

  ["batchExportScope","batchExportOwner","batchExportStage","batchExportDateFrom","batchExportDateTo","batchExportClosed","batchExportLost"].forEach(id=>$(id).addEventListener("change",()=>refreshExportPicker(true)));
  $("batchExportLeadPicker").addEventListener("change",event=>{const input=event.target.closest("[data-batch-lead]");if(!input)return;input.checked?state.selected.add(input.dataset.batchLead):state.selected.delete(input.dataset.batchLead);setPanel("batchExportPanel","batchExportCount","batchExportStatus",`${state.selected.size} conversa(s) selecionada(s)`,"Confira a seleção ou gere o pacote.");$("btnGenerateBatchZip").disabled=!state.selected.size;$("btnDownloadBatchJson").disabled=!state.selected.size;});
  $("btnGenerateBatchZip").addEventListener("click",()=>exportBatch("zip"));$("btnDownloadBatchJson").addEventListener("click",()=>exportBatch("json"));
  $("btnCancelBatchExport").addEventListener("click",()=>{state.cancelled=true;$("batchExportModal").close();});$("btnCloseBatchExport").addEventListener("click",()=>$("batchExportModal").close());
  $("btnCloseBatchImport").addEventListener("click",()=>$("batchImportModal").close());$("btnChooseBatchImport").addEventListener("click",()=>$("batchImportFile").click());
  $("batchImportFile").addEventListener("change",event=>{const file=event.target.files?.[0];if(file)file.text().then(parseImportText);event.target.value="";});
  $("btnPreviewBatchPaste").addEventListener("click",()=>parseImportText($("batchImportPaste").value));
  const drop=$("batchImportDropZone");drop.addEventListener("click",()=>$("batchImportFile").click());drop.addEventListener("dragover",event=>{event.preventDefault();drop.classList.add("dragging");});drop.addEventListener("dragleave",()=>drop.classList.remove("dragging"));drop.addEventListener("drop",event=>{event.preventDefault();drop.classList.remove("dragging");const file=[...event.dataTransfer.files].find(item=>item.name.toLowerCase().endsWith(".json"));if(file)file.text().then(parseImportText);else setPanel("batchImportPanel","batchImportTitle","batchImportStatus","Arquivo não reconhecido","Use um arquivo JSON retornado pelo GPT.","error");});
  $("btnImportValidatedBatch").addEventListener("click",importValidated);$("btnDownloadBatchFailures").addEventListener("click",downloadFailures);
})();
