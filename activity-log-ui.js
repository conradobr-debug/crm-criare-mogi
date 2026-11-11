/* Shared follow-up workflow for Criare leads and Professional Partners. */
(function(){
  'use strict';
  const core=globalThis.CriareActivityLog, esc=escapeHtml;
  let saving=false,requestId='',activeRecordId='',visibleHistory=3;
  const reportFilters={start:core.dateKey(new Date(Date.now()-6*86400000)),end:core.dateKey(new Date()),owner:'',entity:'',type:''};
  const typeOptions=()=>Object.entries(core.types).map(([key,value])=>`<option value="${key}">${esc(value.label)}</option>`).join('');
  const name=id=>profiles.find(p=>p.id===id)?.display_name||'PENDENTE DE CONFIRMAÇÃO';
  const dateTime=value=>new Intl.DateTimeFormat('pt-BR',{timeZone:core.timeZone,dateStyle:'short',timeStyle:'short'}).format(new Date(value));
  const shortDate=value=>value.split('-').reverse().join('/');
  function errorText(error){return error?.message||'Não foi possível salvar. O texto foi mantido para você tentar novamente.';}

  $('appointmentSection').insertAdjacentHTML('beforebegin',`<section id="activityLogSection" class="col-12 followupSection">
    <div class="followupHeading"><div><h3>Histórico de atividades</h3><p>O que foi feito, quando e por quem.</p></div><button type="button" class="primary" id="btnQuickActivity">+ Registrar atividade</button></div>
    <div id="activityLogHistory"></div><button type="button" class="ghost" id="btnMoreActivities" hidden>Ver histórico completo</button>
  </section>`);
  const notesWrap=$('notes').parentElement;
  notesWrap.classList.add('legacyActivityNotes');
  notesWrap.querySelector('label').textContent='Notas anteriores e contexto geral';
  $('notes').placeholder='Informações gerais do cadastro. Use Registrar atividade para novos contatos e visitas.';
  $('notes').insertAdjacentHTML('afterend','<div class="fieldHelp">As notas existentes foram preservadas. Novas atividades devem ser registradas no histórico acima para aparecerem no relatório diário.</div>');
  document.body.insertAdjacentHTML('beforeend',`<dialog id="quickActivityDialog" class="followupDialog" aria-labelledby="quickActivityTitle">
    <div class="modalHd"><div><div class="modalTitle" id="quickActivityTitle">Registrar atividade</div><div class="modalSub" id="quickActivityName"></div></div><button type="button" class="ghost" data-close-activity>Fechar</button></div>
    <form id="quickActivityForm"><div class="modalBd followupFields">
      <div class="followupShortcuts"><button type="button" class="ghost" data-activity-type="phone_answered">Ligação atendida</button><button type="button" class="ghost" data-activity-type="phone_unanswered">Não atendeu</button><button type="button" class="ghost" data-activity-type="showroom">Visita ao showroom</button></div>
      <div><label for="quickActivityType">Atividade realizada</label><select id="quickActivityType" required>${typeOptions()}</select></div>
      <div><label for="quickActivityAt">Quando aconteceu</label><input id="quickActivityAt" type="datetime-local" required/><small>Horário de São Paulo</small></div>
      <div class="followupFull"><label for="quickActivitySummary">O que aconteceu?</label><textarea id="quickActivitySummary" rows="3" maxlength="5000" required placeholder="Ex.: conversei por telefone; o cliente ficou de visitar o showroom."></textarea></div>
      <div class="followupFull"><label for="quickActivityOwner">Quem realizou</label><select id="quickActivityOwner" required></select></div>
      <div class="followupFull followupNext"><h3>Próxima ação <small>opcional</small></h3><label for="quickActivityNext">O que fazer depois?</label><input id="quickActivityNext" maxlength="2000" placeholder="Ex.: confirmar a visita ao showroom"/>
        <div class="followupDateRow"><div><label for="quickActivityNextDate">Data</label><input id="quickActivityNextDate" type="date"/></div><div><label for="quickActivityNextTime">Horário</label><input id="quickActivityNextTime" type="time" value="09:00"/></div></div>
        <div class="followupShortcuts"><button type="button" class="ghost" data-activity-next-days="1">Amanhã</button><button type="button" class="ghost" data-activity-next-days="7">Em 7 dias</button></div><small>Será adicionada à agenda do cadastro. Os compromissos existentes são mantidos.</small>
      </div>
      <details class="followupFull"><summary>Concluir um compromisso existente</summary><label for="quickActivityCompleted">Esta atividade cumpriu qual compromisso?</label><select id="quickActivityCompleted"><option value="">Nenhum</option></select><small>Apenas o compromisso escolhido será concluído.</small></details>
      <div id="quickActivityError" class="followupError followupFull" role="alert" hidden></div>
    </div><div class="modalFt"><span class="note">A atividade será salva neste cadastro.</span><button type="submit" class="primary" id="btnSaveQuickActivity">Salvar atividade</button></div></form>
  </dialog>`);

  function renderHistory(record){
    const rows=core.entries(record?[record]:[]);
    $('btnQuickActivity').disabled=!record;
    $('activityLogHistory').innerHTML=rows.length?rows.slice(0,visibleHistory).map(row=>`<article class="followupEntry"><div><b>${esc(row.label)}</b><time>${row.day?esc(dateTime(row.at)):'PENDENTE DE CONFIRMAÇÃO'}</time></div><p>${esc(row.summary)}</p><small>${esc(name(row.performer_id))}${row.result?` · ${esc(row.result)}`:''}${row.legacy?' · registro anterior':''}</small>${row.recorded_at?`<small>Registrado em ${esc(dateTime(row.recorded_at))} por ${esc(name(row.recorded_by))}</small>`:''}</article>`).join(''):`<p class="fieldHelp">${record?'Nenhuma atividade estruturada registrada. As notas anteriores continuam abaixo.':'Salve o cadastro para começar o histórico.'}</p>`;
    $('btnMoreActivities').hidden=rows.length<=visibleHistory;
  }
  function openActivity(record){
    if(!record||!session?.user||!sb)return toast('Salve o cadastro e entre na sua conta para registrar atividades.');
    activeRecordId=record.id;requestId=crypto.randomUUID();
    $('quickActivityForm').reset();
    $('quickActivityName').textContent=fullName(record)+(isSpecifier(record)?' · Professional Partners':' · Lead / cliente');
    $('quickActivityAt').value=core.dateTimeInput();
    $('quickActivityOwner').innerHTML=profiles.map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join('');
    $('quickActivityOwner').value=session.user.id;
    $('quickActivityCompleted').innerHTML='<option value="">Nenhum</option>'+(Array.isArray(record.appointments)?record.appointments:[]).filter(a=>a.status==='scheduled'&&a.starts_at).map(a=>`<option value="${esc(a.id)}">${esc(a.details||a.kind)} · ${esc(dateTime(a.starts_at))}</option>`).join('');
    $('quickActivityError').hidden=true;
    $('quickActivityDialog').showModal();
    $('quickActivitySummary').focus();
    return false; // Keep any unsaved edits in the underlying record form.
  }
  $('btnQuickActivity').addEventListener('click',()=>openActivity(records.find(r=>r.id===$('id').value)));
  $('btnMoreActivities').addEventListener('click',()=>{visibleHistory=Infinity;renderHistory(records.find(r=>r.id===$('id').value));});
  $('quickActivityDialog').addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  $('quickActivityDialog').addEventListener('click',event=>{
    const close=event.target.closest('[data-close-activity]');if(close&&!saving)$('quickActivityDialog').close();
    const type=event.target.closest('[data-activity-type]');if(type){$('quickActivityType').value=type.dataset.activityType;$('quickActivitySummary').focus();}
    const day=event.target.closest('[data-activity-next-days]');if(day)$('quickActivityNextDate').value=core.dateKey(new Date(Date.now()+Number(day.dataset.activityNextDays)*86400000));
  });
  $('quickActivityForm').addEventListener('submit',async event=>{
    event.preventDefault();if(saving)return;
    const record=records.find(r=>r.id===activeRecordId);if(!record)return;
    $('quickActivityError').hidden=true;
    try{
      const activity=core.validateActivity({id:requestId,activity_type:$('quickActivityType').value,summary:$('quickActivitySummary').value,at:core.inputToIso($('quickActivityAt').value),performed_by:$('quickActivityOwner').value});
      const details=$('quickActivityNext').value.trim(),date=$('quickActivityNextDate').value;
      if(Boolean(details)!==Boolean(date))throw new Error('Para agendar a próxima ação, preencha o que fazer e a data.');
      const next=date?{details,starts_at:core.inputToIso(`${date}T${$('quickActivityNextTime').value||'09:00'}`)}:null;
      if(next&&new Date(next.starts_at).getTime()<Date.now()-60000)throw new Error('Escolha uma data e um horário futuros para a próxima ação.');
      saving=true;$('quickActivityForm').inert=true;$('btnSaveQuickActivity').disabled=true;$('btnSaveQuickActivity').textContent='Salvando…';
      const completed=$('quickActivityCompleted').value||null;
      const {data,error}=await sb.rpc('crm_log_followup_activity',{p_record_id:record.id,p_activity:activity,p_next_action:next,p_completed_appointment_id:completed});
      if(error)throw error;
      const saved=Array.isArray(data)?data[0]:data;
      if(!saved?.id)throw new Error('Não foi possível confirmar a gravação. Tente novamente.');
      records[records.findIndex(r=>r.id===saved.id)]=saved;
      if($('modal').open&&$('id').value===saved.id){
        const previousIds=new Set((record.appointments||[]).map(a=>a.id));
        const latest=normalizeAppointments(saved);
        appointmentDrafts=appointmentDrafts.map(a=>a.id===completed?(latest.find(v=>v.id===a.id)||a):a);
        const legacy=latest.find(a=>a.source==='legacy_followup');
        if(legacy&&!record.appointments?.length){
          const prior=getLegacyNextActionAt(record)?.getTime();
          appointmentDrafts=appointmentDrafts.map(a=>new Date(a.starts_at).getTime()===prior?{...a,id:legacy.id}:a);
        }
        const draftIds=new Set(appointmentDrafts.map(a=>a.id));
        appointmentDrafts.push(...latest.filter(a=>!previousIds.has(a.id)&&!draftIds.has(a.id)&&a.source!=='legacy_followup'));
        renderAppointmentList();renderHistory(saved);
        if(isSpecifier(saved))partnerRenderTimeline(saved);
      }
      $('quickActivityDialog').close();render();
      toast(next?'Atividade registrada e próxima ação agendada.':'Atividade registrada.');
      fetchRecordEvents().catch(()=>{});
    }catch(error){$('quickActivityError').textContent=errorText(error);$('quickActivityError').hidden=false;}
    finally{saving=false;$('quickActivityForm').inert=false;$('btnSaveQuickActivity').disabled=false;$('btnSaveQuickActivity').textContent='Salvar atividade';}
  });
  registerContactNow=async record=>openActivity(record);
  $('btnLogContact').textContent='Registrar atividade';

  // Keep the simple next-action fields visible; calendar options stay available.
  const composer=$('appointmentComposer');delete composer.dataset.partnerGroup;
  const detailsField=$('nextActionDetails').parentElement;
  composer.prepend(detailsField);
  detailsField.querySelector('label').textContent='O que fazer depois?';
  $('nextActionDetails').placeholder='Ex.: ligar para confirmar a visita ao showroom';
  $('nextActionDetails').rows=2;
  $('wrapNextActionDate').querySelector('label').textContent='Data da próxima ação';
  $('btnShowAppointmentComposer').textContent='+ Próxima ação';
  $('btnAddAppointment').textContent='Adicionar próxima ação';
  composer.insertAdjacentHTML('beforeend','<details id="followupCalendarOptions" class="col-12 followupCalendarOptions"><summary>Mais opções de agenda</summary><div class="followupFields" id="followupCalendarFields"></div></details>');
  ['nextActionKind','nextActionDuration','nextActionReminder','appointmentParticipants'].forEach(id=>$('followupCalendarFields').appendChild($(id).parentElement));
  composer.appendChild($('btnAddAppointment').parentElement);
  const renderAppointmentsOriginal=renderAppointmentList;
  renderAppointmentList=function(){
    renderAppointmentsOriginal();
    for(const item of appointmentDrafts.filter(a=>a.status==='completed')){
      const card=$('appointmentList').querySelector(`[data-appointment-id="${CSS.escape(item.id)}"] .appointmentItemMain`);
      if(card)card.insertAdjacentHTML('afterbegin','<span class="badge">Concluído</span> ');
    }
  };
  const openOriginal=openModal;
  openModal=function(record=null,options={}){
    openOriginal(record,options);visibleHistory=3;renderHistory(record);
    setLeadSectionOpen('appointmentSection',true);composer.hidden=false;
    $('appointmentSection').querySelector('[data-toggle-section] span').textContent='Próxima ação e agenda';
    if(options.focusSchedule)$('nextActionDetails').focus();
  };
  function validComposer(){
    if($('nextActionDetails').value.trim()&&!$('nextAction').value){toast('Escolha a data da próxima ação.');$('nextAction').focus();return false;}
    if($('nextAction').value&&!$('nextActionDetails').value.trim()){toast('Anote o que deve ser feito na próxima ação.');$('nextActionDetails').focus();return false;}
    return true;
  }
  const addOriginal=addAppointmentFromComposer;
  addAppointmentFromComposer=function(options){if(!validComposer())return false;const result=addOriginal(options);if(result&&!options?.silent)toast('Próxima ação adicionada. Clique em Salvar no cadastro.');setLeadSectionOpen('appointmentSection',true);composer.hidden=false;return result;};
  const saveOriginal=upsertFromForm;
  upsertFromForm=async function(){if(!validComposer())return false;return saveOriginal();};

  function reportMarkup(){
    const invalid=reportFilters.start>reportFilters.end;
    const data=core.report(records,reportFilters);
    const rowMarkup=data.rows.map(row=>`<tr><td>${esc(dateTime(row.at))}</td><td><button type="button" class="ghost followupRecordLink" data-activity-record="${esc(row.record_id)}">${esc(row.name)}</button><small>${row.entity_type==='specifier'?'Professional Partners':'Lead / cliente'}</small></td><td>${esc(row.label)}<small>${esc(row.result||'')}</small></td><td>${esc(name(row.performer_id))}</td><td class="followupDescription">${esc(row.summary)}</td></tr>`).join('');
    return `<section id="dailyActivityReport" class="followupReport">
      <div class="followupHeading"><div><h2>Atividades realizadas por dia</h2><p>Data da realização · horário de São Paulo · registros de leads e Professional Partners.</p></div><button class="ghost" type="button" id="btnActivityCsv" ${invalid||!data.total?'disabled':''}>Exportar CSV</button></div>
      <div class="followupReportFilters"><div><label for="activityReportStart">De</label><input type="date" id="activityReportStart" data-activity-filter="start" value="${esc(reportFilters.start)}"/></div><div><label for="activityReportEnd">Até</label><input type="date" id="activityReportEnd" data-activity-filter="end" value="${esc(reportFilters.end)}"/></div><div><label for="activityReportOwner">Quem realizou</label><select id="activityReportOwner" data-activity-filter="owner"><option value="">Todos</option>${profiles.map(p=>`<option value="${esc(p.id)}" ${reportFilters.owner===p.id?'selected':''}>${esc(p.display_name)}</option>`).join('')}</select></div><div><label for="activityReportEntity">Cadastros</label><select id="activityReportEntity" data-activity-filter="entity"><option value="">Todos</option><option value="lead" ${reportFilters.entity==='lead'?'selected':''}>Leads / clientes</option><option value="specifier" ${reportFilters.entity==='specifier'?'selected':''}>Professional Partners</option></select></div><div><label for="activityReportType">Atividade</label><select id="activityReportType" data-activity-filter="type"><option value="">Todas</option>${Object.entries(core.types).map(([key,type])=>`<option value="${key}" ${reportFilters.type===key?'selected':''}>${esc(type.label)}</option>`).join('')}<option value="legacy" ${reportFilters.type==='legacy'?'selected':''}>Contatos anteriores</option></select></div></div>
      <div class="followupShortcuts"><button type="button" class="ghost" data-activity-period="today">Hoje</button><button type="button" class="ghost" data-activity-period="yesterday">Ontem</button><button type="button" class="ghost" data-activity-period="week">Últimos 7 dias</button></div>
      ${invalid?'<p class="followupError" role="alert">A data inicial deve ser anterior ou igual à final.</p>':`
      <div class="followupTotals"><strong>${data.total} atividade(s)</strong><span>${data.contacts} cadastro(s)</span><span>${data.rows.filter(r=>r.activity_type==='phone_unanswered').length} ligação(ões) não atendida(s)</span></div>
      <div class="followupReportColumns"><section><h3>Por dia</h3>${data.days.length?`<div class="followupTableWrap"><table><thead><tr><th>Dia</th><th>Total</th><th>Leads / clientes</th><th>Partners</th></tr></thead><tbody>${data.days.map(d=>`<tr><td>${esc(shortDate(d.day))}</td><td>${d.total}</td><td>${d.leads}</td><td>${d.partners}</td></tr>`).join('')}</tbody></table></div>`:'<p>Nenhuma atividade registrada neste período.</p>'}</section><section><h3>Por pessoa</h3>${data.byOwner.map(([id,total])=>`<p>${esc(name(id))}: <b>${total}</b></p>`).join('')||'<p>Sem registros.</p>'}<h3>Por atividade</h3>${data.byType.map(([label,total])=>`<p>${esc(label)}: <b>${total}</b></p>`).join('')}</section></div>
      <h3>Detalhamento das atividades</h3><div class="followupTableWrap"><table><thead><tr><th>Quando</th><th>Cadastro</th><th>Atividade / resultado</th><th>Quem realizou</th><th>O que aconteceu</th></tr></thead><tbody>${rowMarkup||'<tr><td colspan="5">Nenhuma atividade para os filtros selecionados.</td></tr>'}</tbody></table></div>`}
      <p class="fieldHelp">Este relatório conta apenas atividades estruturadas. Compromissos futuros, mudanças de etapa e texto livre das notas não entram na contagem. Dias sem registros correspondem a zero atividades registradas.${data.undated?` ${data.undated} registro(s) sem data válida: PENDENTE DE CONFIRMAÇÃO.`:''}</p>
    </section>`;
  }
  const reportOriginal=renderReports;
  renderReports=function(){return `<div class="followupReportsStack">${reportMarkup()}${reportOriginal()}</div>`;};
  document.addEventListener('change',event=>{
    const key=event.target.dataset.activityFilter;if(!key)return;
    reportFilters[key]=event.target.value;refreshReport();
  });
  function refreshReport(){$('dailyActivityReport').outerHTML=reportMarkup();}
  document.addEventListener('click',event=>{
    const period=event.target.closest('[data-activity-period]');
    if(period){const value=period.dataset.activityPeriod;reportFilters.end=core.dateKey(new Date(Date.now()-(value==='yesterday'?86400000:0)));reportFilters.start=value==='week'?core.dateKey(new Date(Date.now()-6*86400000)):reportFilters.end;refreshReport();}
    const record=event.target.closest('[data-activity-record]');if(record)openModal(records.find(r=>r.id===record.dataset.activityRecord));
    if(event.target.closest('#btnActivityCsv')){
      const csv=core.csv(core.report(records,reportFilters).rows,name),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})),link=document.createElement('a');
      link.href=url;link.download=`criare-atividades-${reportFilters.start||'inicio'}-${reportFilters.end||'fim'}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  });
})();
