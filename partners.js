/* Parceiros Criare Mogi Guaçu — relacionamento, cadências e conteúdo. */
const PARTNER_STAGES = [
  "Mapeado", "Contato iniciado", "Visita agendada", "Visitou a loja",
  "Relacionamento", "Oportunidade identificada", "Projeto recebido",
  "Parceiro ativo", "Adormecido"
];
const PARTNER_CLASSIFICATIONS = ["Não classificado", "A — Estratégico", "B — Potencial", "C — Relacionamento"];
const RELATIONSHIP_LEVELS = ["Novo", "Em desenvolvimento", "Ativo", "Recorrente"];
const PARTNER_REQUIRED_NEXT_ACTION_STAGES = new Set(PARTNER_STAGES.slice(1, 8));
const PARTNER_INTEREST_TAGS = [
  "Cozinhas", "Closets", "Áreas gourmet", "Dormitórios", "Banheiros", "Home", "Comercial",
  "Madeira natural", "Laca", "Ferragens", "Iluminação", "Soluções técnicas", "Tendências",
  "Alto padrão", "Reformas", "Obras novas"
];
const CONTENT_PILLARS = [
  "Design e inspiração", "Conteúdo técnico", "Apoio comercial ao arquiteto",
  "Diferenciais da Criare", "Cases e provas", "Experiências e relacionamento"
];
const CONTENT_FORMATS = ["Imagem", "Vídeo", "PDF", "Catálogo", "Case", "Texto", "Link", "Convite", "Amostra física", "Outro"];
const CONTACT_CHANNELS = ["WhatsApp", "Ligação", "Áudio", "E-mail", "Reunião na loja", "Visita ao escritório", "Café ou encontro", "Evento", "Envio de conteúdo", "Outro"];
const CONTACT_RESULTS = ["Sem resposta", "Conteúdo enviado", "Conversa realizada", "Visita agendada", "Interesse demonstrado", "Oportunidade identificada", "Projeto recebido", "Sem projeto no momento", "Retomar futuramente", "Sem interesse"];
const INITIAL_CADENCE = [
  {day:1, key:"initial_d1", title:"Agradecimento pós-visita", channel:"WhatsApp", objective:"Agradecer, mencionar ponto específico da conversa e reforçar proximidade."},
  {day:7, key:"initial_d7", title:"Enviar conteúdo personalizado", channel:"WhatsApp / conteúdo", objective:"Enviar apenas um conteúdo relacionado aos interesses do parceiro."},
  {day:15, key:"initial_d15", title:"Mapear projetos em andamento", channel:"Ligação ou áudio", objective:"Verificar se existe obra, projeto ou cliente entrando na fase de marcenaria."},
  {day:30, key:"initial_d30", title:"Enviar case ou solução técnica", channel:"WhatsApp / conteúdo", objective:"Demonstrar um problema real e como a Criare ajudou a resolvê-lo."},
  {day:45, key:"initial_d45", title:"Contato estratégico do proprietário", channel:"Ligação, café ou convite", objective:"Reforçar o peso institucional da parceria.", classification:"A — Estratégico", strategic:true},
  {day:60, key:"initial_d60", title:"Buscar primeira oportunidade", channel:"Ligação ou WhatsApp", objective:"Perguntar de forma objetiva se existe algum projeto no qual a Criare possa começar a trabalhar."},
  {day:90, key:"initial_d90", title:"Revisar relacionamento e classificação", channel:"Revisão interna ou contato", objective:"Classificar o parceiro, revisar potencial e definir a cadência permanente."}
];
const PERMANENT_CADENCES = {
  "Estratégico": [
    {days:18, title:"Conteúdo ou mensagem personalizada", channel:"WhatsApp / conteúdo"},
    {days:30, title:"Ligação de relacionamento", channel:"Ligação", ownerName:"Marianna"},
    {days:42, title:"Conteúdo ou convite", channel:"WhatsApp / convite"},
    {days:55, title:"Contato institucional", channel:"Ligação, café ou convite", ownerName:"Conrado"},
    {days:90, title:"Revisão estratégica trimestral", channel:"Revisão interna"}
  ],
  "Potencial": [
    {days:30, title:"Enviar conteúdo relevante", channel:"WhatsApp / conteúdo"},
    {days:60, title:"Ligação, convite ou contato pessoal", channel:"Ligação ou convite"},
    {days:90, title:"Revisar classificação", channel:"Revisão interna"}
  ],
  "Relacionamento": [
    {days:50, title:"Conteúdo ou convite de relacionamento", channel:"WhatsApp / convite"},
    {days:75, title:"Campanha de reativação", channel:"WhatsApp ou ligação"},
    {days:90, title:"Revisar classificação", channel:"Revisão interna"}
  ]
};

SPECIFIER_STAGES.splice(0, SPECIFIER_STAGES.length, ...PARTNER_STAGES);
Object.assign(filters, {partnerClassification:"Todos", relationshipLevel:"Todos", cadence:"Todos", opportunity:"Todos", attention:"Todos"});

function partnerCsv(value){
  return String(value || "").split(",").map(item=>item.trim()).filter(Boolean);
}
function partnerLocalDateTimeValue(iso){
  const date = iso ? new Date(iso) : new Date();
  if(Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0,16);
}
function partnerAdjustedDate(baseValue, days, time="09:00"){
  const base = new Date(baseValue || Date.now());
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + Number(days), Number(time.split(":")[0] || 9), Number(time.split(":")[1] || 0), 0, 0);
  if(date.getDay() === 6) date.setDate(date.getDate() + 2);
  if(date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date.toISOString();
}
function partnerProfileByName(name){
  const needle = String(name || "").toLowerCase();
  return profiles.find(profile=>String(profile.display_name || "").toLowerCase().includes(needle)) || null;
}
function partnerDaysWithoutContact(record){
  const value = record.last_contact_at || record.first_visit_at || record.created_at;
  if(!value) return null;
  return Math.max(0, daysBetween(new Date(value), new Date()));
}
function partnerNeedsNextAction(record){ return PARTNER_REQUIRED_NEXT_ACTION_STAGES.has(record.stage); }
function partnerHasOpportunity(record){ return ["Oportunidade identificada", "Projeto recebido", "Parceiro ativo"].includes(record.stage); }
function partnerOwnerOption(id){
  return profiles.map(profile=>`<option value="${escapeHtml(profile.id)}" ${profile.id===id?"selected":""}>${escapeHtml(profile.display_name)}</option>`).join("");
}
function partnerNormalizeAppointment(item){
  return {
    ...item,
    id:item.id || crypto.randomUUID(),
    starts_at:item.starts_at || null,
    kind:item.kind || "Follow-up",
    details:item.details || null,
    duration_minutes:Number(item.duration_minutes || 30),
    reminder_minutes:Number(item.reminder_minutes ?? 30),
    status:item.status || "scheduled",
    event_id:item.event_id || null,
    web_link:item.web_link || null,
    synced_at:item.synced_at || null
  };
}
function partnerCreateInitialCadence(record, baseValue, classification, ownerId){
  const existing = new Set(normalizeAppointments(record).map(item=>item.cadence_key).filter(Boolean));
  const conrado = partnerProfileByName("Conrado");
  return INITIAL_CADENCE
    .filter(item=>!item.classification || item.classification === classification)
    .filter(item=>!existing.has(item.key))
    .map(item=>partnerNormalizeAppointment({
      id:crypto.randomUUID(), starts_at:partnerAdjustedDate(baseValue, item.day), kind:item.title,
      details:item.objective, objective:item.objective, channel:item.channel,
      owner_id:item.strategic ? (conrado?.id || null) : (ownerId || null),
      owner_name:item.strategic ? "Conrado" : profileNameById(ownerId),
      source:"cadence_auto", cadence_key:item.key, cadence_type:"Inicial 90 dias", cadence_day:item.day,
      duration_minutes:30, reminder_minutes:30, status:"scheduled"
    }));
}
function partnerNextPermanentAppointment(record, completedAt=new Date().toISOString()){
  const cadence = PERMANENT_CADENCES[record.cadence_type];
  if(!cadence?.length) return null;
  const cycle = Math.max(0, Number(record.cadence_cycle || 0));
  const item = cadence[cycle % cadence.length];
  const named = item.ownerName ? partnerProfileByName(item.ownerName) : null;
  return partnerNormalizeAppointment({
    id:crypto.randomUUID(), starts_at:partnerAdjustedDate(completedAt, item.days), kind:item.title,
    details:`Próxima ação da cadência permanente ${record.cadence_type}.`, channel:item.channel,
    owner_id:named?.id || record.owner_id || null, owner_name:item.ownerName || profileNameById(record.owner_id),
    source:"cadence_auto", cadence_key:`permanent_${record.cadence_type}_${cycle+1}`,
    cadence_type:record.cadence_type, cadence_cycle:cycle+1,
    duration_minutes:30, reminder_minutes:30, status:"scheduled"
  });
}

function partnerInjectInterface(){
  const kpis = document.createElement("div");
  kpis.id = "partnerKpis";
  kpis.className = "partnerKpis";
  kpis.hidden = true;
  document.querySelector(".toolbar")?.insertAdjacentElement("afterend", kpis);

  const extraFilters = document.createElement("div");
  extraFilters.id = "partnerExtraFilters";
  extraFilters.className = "partnerExtraFilters";
  extraFilters.hidden = true;
  extraFilters.innerHTML = `
    <div class="field"><label>Classificação</label><select id="fPartnerClassification"><option>Todos</option>${PARTNER_CLASSIFICATIONS.map(v=>`<option>${escapeHtml(v)}</option>`).join("")}</select></div>
    <div class="field"><label>Nível</label><select id="fRelationshipLevel"><option>Todos</option>${RELATIONSHIP_LEVELS.map(v=>`<option>${escapeHtml(v)}</option>`).join("")}</select></div>
    <div class="field"><label>Cadência</label><select id="fPartnerCadence"><option>Todos</option><option>Ativa</option><option>Inativa</option></select></div>
    <div class="field"><label>Oportunidade</label><select id="fPartnerOpportunity"><option>Todos</option><option>Com oportunidade</option><option>Sem oportunidade</option></select></div>
    <div class="field"><label>Acompanhamento</label><select id="fPartnerAttention"><option>Todos</option><option>Sem próxima ação</option><option>Contato vencido</option><option>Adormecidos</option></select></div>
    <button class="primary" id="btnContentBank" type="button">Banco de conteúdos</button>`;
  document.querySelector(".toolbar")?.appendChild(extraFilters);
  [["fPartnerClassification","partnerClassification"],["fRelationshipLevel","relationshipLevel"],["fPartnerCadence","cadence"],["fPartnerOpportunity","opportunity"],["fPartnerAttention","attention"]].forEach(([id,key])=>{
    $(id).addEventListener("change", event=>{ filters[key]=event.target.value; render(); });
  });
  $("btnContentBank").addEventListener("click", partnerOpenContentBank);

  const form = $("form");
  form.insertAdjacentHTML("afterbegin", `<div id="partnerFormTabs" class="partnerFormTabs col-12" hidden>
    <button type="button" class="active" data-partner-form-tab="basic">Dados básicos</button>
    <button type="button" data-partner-form-tab="profile">Perfil e potencial</button>
    <button type="button" data-partner-form-tab="relationship">Relacionamento e agenda</button>
    <button type="button" data-partner-form-tab="whatsapp">WhatsApp e análise</button>
  </div>`);
  $("partnerFormTabs").addEventListener("click", event=>{
    const button = event.target.closest("[data-partner-form-tab]");
    if(button) partnerSelectFormTab(button.dataset.partnerFormTab);
  });

  $("wrapCompanyName").insertAdjacentHTML("afterend", `<section id="partnerProfileSection" class="partnerOnly partnerFormSection col-12" data-partner-group="profile" hidden>
    <div class="partnerSectionTitle"><div><b>Perfil e potencial</b><span>Informações para personalizar o relacionamento.</span></div></div>
    <div class="partnerSectionGrid">
      <div class="col-4"><label>Classificação do parceiro</label><select id="partnerClassification">${PARTNER_CLASSIFICATIONS.map(v=>`<option>${escapeHtml(v)}</option>`).join("")}</select><div class="fieldHelp">A: estratégico e com possibilidade concreta de negócios. B: bom potencial em desenvolvimento. C: relacionamento inicial ou de menor aderência.</div></div>
      <div class="col-4"><label>Nível de relacionamento</label><select id="relationshipLevel">${RELATIONSHIP_LEVELS.map(v=>`<option>${escapeHtml(v)}</option>`).join("")}</select></div>
      <div class="col-4"><label>Origem do parceiro</label><input id="partnerOrigin" /></div>
      <div class="col-4"><label>Região de atuação</label><input id="partnerRegion" /></div>
      <div class="col-4"><label>Data da primeira visita</label><input id="firstVisitAt" type="date" /></div>
      <div class="col-4"><label>Perfil financeiro dos clientes</label><input id="partnerClientProfile" /></div>
      <div class="col-6"><label>Perfil dos projetos</label><textarea id="partnerProjectProfile"></textarea></div>
      <div class="col-6"><label>Estilo predominante</label><input id="preferredStyles" placeholder="Separe por vírgulas" /></div>
      <div class="col-6"><label>Ambientes que costuma especificar</label><input id="preferredEnvironments" placeholder="Separe por vírgulas" /></div>
      <div class="col-6"><label>Marcas ou fornecedores com quem já trabalha</label><textarea id="currentSuppliers"></textarea></div>
      <div class="col-6"><label>O que mais valorizou na Criare</label><textarea id="valuedDifferentials"></textarea></div>
      <div class="col-6"><label>Objeções ou inseguranças percebidas</label><textarea id="partnerObjections"></textarea></div>
      <div class="col-12"><label>Projetos ou obras mencionados</label><textarea id="mentionedProjects"></textarea></div>
      <div class="col-12"><label>Interesses e temas preferidos</label><div class="tagPicker" id="partnerInterestTags">${PARTNER_INTEREST_TAGS.map(tag=>`<label><input type="checkbox" value="${escapeHtml(tag)}" /> ${escapeHtml(tag)}</label>`).join("")}</div></div>
    </div>
  </section>
  <section id="partnerRelationshipSection" class="partnerOnly partnerFormSection col-12" data-partner-group="relationship" hidden>
    <div class="partnerSectionTitle"><div><b>Cadência de relacionamento</b><span>O parceiro continua com um responsável principal.</span></div></div>
    <div class="partnerSectionGrid">
      <div class="col-3"><label>Cadência ativa</label><select id="cadenceActive"><option value="false">Inativa</option><option value="true">Ativa</option></select></div>
      <div class="col-3"><label>Tipo da cadência</label><select id="cadenceType"><option>Manual</option><option>Inicial 90 dias</option><option>Estratégico</option><option>Potencial</option><option>Relacionamento</option></select></div>
      <div class="col-3"><label>Data de início</label><input id="cadenceStartedAt" type="date" /></div>
      <div class="col-3"><label>Responsável pela próxima ação</label><select id="nextActionOwner"></select></div>
      <div class="col-12 cadenceActivation" id="cadenceActivation" hidden><label><input id="activateInitialCadence" type="checkbox" checked /> Ativar a cadência inicial de relacionamento de 90 dias ao salvar</label></div>
      <div class="col-12"><div class="timelineHeader"><b>Linha do tempo</b><select id="timelineFilter"><option value="all">Tudo</option><option value="contacts">Contatos</option><option value="appointments">Compromissos</option><option value="contents">Conteúdos</option><option value="stages">Etapas</option><option value="opportunities">Oportunidades</option></select></div><div id="partnerTimeline" class="partnerTimeline"></div></div>
    </div>
  </section>`);
  $("timelineFilter").addEventListener("change", ()=>partnerRenderTimeline(records.find(r=>r.id===$("id").value)));

  const direct = Array.from(form.children);
  const basicIds = new Set(["firstName","lastName","phone","city","owner","stage","wrapSpecifierType","wrapCompanyName","email","notes"]);
  direct.forEach(child=>{
    const ownId = child.id;
    const containsBasic = ownId && basicIds.has(ownId) || Array.from(child.querySelectorAll("[id]")).some(node=>basicIds.has(node.id));
    if(containsBasic) child.dataset.partnerGroup = "basic";
  });
  $("appointmentComposer").dataset.partnerGroup = "relationship";
  document.querySelector(".whatsappWorkspace").dataset.partnerGroup = "whatsapp";

  document.body.insertAdjacentHTML("beforeend", partnerDialogsMarkup());
  partnerBindDialogs();
}

function partnerDialogsMarkup(){
  return `<dialog id="contactModal" class="partnerDialog"><div class="modalHd"><div><div class="modalTitle">Registrar contato</div><div class="modalSub" id="contactPartnerName"></div></div><button class="ghost" type="button" id="btnCloseContact">Fechar</button></div>
    <div class="modalBd"><form class="form" id="contactForm">
      <div class="col-4"><label>Data e horário</label><input id="contactAt" type="datetime-local" /></div>
      <div class="col-4"><label>Responsável</label><select id="contactOwner"></select></div>
      <div class="col-4"><label>Canal</label><select id="contactChannel">${CONTACT_CHANNELS.map(v=>`<option>${escapeHtml(v)}</option>`).join("")}</select></div>
      <div class="col-4"><label>Tipo de contato</label><input id="contactType" placeholder="Ex.: acompanhamento, prospecção" /></div>
      <div class="col-4"><label>Resultado</label><select id="contactResult">${CONTACT_RESULTS.map(v=>`<option>${escapeHtml(v)}</option>`).join("")}</select></div>
      <div class="col-4"><label>Compromisso relacionado</label><select id="relatedAppointment"><option value="">Nenhum</option></select></div>
      <div class="col-6"><label>Objetivo</label><textarea id="contactObjective"></textarea></div>
      <div class="col-6"><label>Resumo do que aconteceu</label><textarea id="contactSummary" required></textarea></div>
      <div class="col-6"><label>Projeto ou obra mencionada</label><textarea id="contactProject"></textarea></div>
      <div class="col-6"><label>Conteúdo enviado</label><select id="contactContent"><option value="">Nenhum</option></select><div id="contentSuggestions" class="fieldHelp"></div></div>
      <div class="col-4"><label>Próxima ação</label><input id="contactNextAction" /></div>
      <div class="col-4"><label>Data da próxima ação</label><input id="contactNextAt" type="datetime-local" /></div>
      <div class="col-4"><label>Responsável pela próxima ação</label><select id="contactNextOwner"></select></div>
    </form></div><div class="modalFt"><div class="note">Ao salvar, o histórico e o último contato serão atualizados.</div><div class="modalQuick"><button class="ghost" type="button" id="btnCancelContact">Cancelar</button><button class="primary" type="button" id="btnSaveContact">Salvar contato</button></div></div></dialog>

  <dialog id="contentBankModal" class="contentBankDialog"><div class="modalHd"><div><div class="modalTitle">Banco de conteúdos</div><div class="modalSub">Links e referências da Criare para relacionamento com parceiros.</div></div><button class="ghost" type="button" id="btnCloseContentBank">Fechar</button></div>
    <div class="modalBd contentBankLayout"><form id="contentForm" class="contentEditor"><input id="contentId" type="hidden" /><label>Título</label><input id="contentTitle" required /><label>Pilar</label><select id="contentPillar">${CONTENT_PILLARS.map(v=>`<option>${escapeHtml(v)}</option>`).join("")}</select><label>Formato</label><select id="contentFormat">${CONTENT_FORMATS.map(v=>`<option>${escapeHtml(v)}</option>`).join("")}</select><label>Descrição</label><textarea id="contentDescription"></textarea><label>Link externo</label><input id="contentUrl" type="url" placeholder="Google Drive, site, Instagram, YouTube ou catálogo" /><label>Tags</label><input id="contentTags" placeholder="Separe por vírgulas" /><label>Status</label><select id="contentStatus"><option>Ativo</option><option>Arquivado</option></select><label>Observações internas</label><textarea id="contentNotes"></textarea><button class="primary" type="button" id="btnSaveContent">Salvar conteúdo</button><button class="ghost" type="button" id="btnNewContent">Limpar formulário</button></form><div><div class="contentListTools"><input id="contentSearch" placeholder="Buscar conteúdo ou tag" /><select id="contentStatusFilter"><option>Ativo</option><option>Arquivado</option><option>Todos</option></select></div><div id="contentList" class="contentList"></div></div></div></dialog>

  <dialog id="nextActionWarning" class="smallDecisionDialog"><div class="modalHd"><div class="modalTitle">Próxima ação necessária</div></div><div class="modalBd"><p>Este parceiro ficará sem acompanhamento. Deseja salvar mesmo assim?</p><div id="nextActionReasonWrap" hidden><label>Justificativa</label><textarea id="nextActionReason"></textarea></div></div><div class="modalFt"><button class="ghost" type="button" data-next-decision="cancel">Cancelar</button><button class="ghost" type="button" data-next-decision="create">Criar próxima ação</button><button class="danger" type="button" data-next-decision="justify">Salvar com justificativa</button></div></dialog>`;
}

function partnerBindDialogs(){
  $("btnCloseContact").addEventListener("click", ()=>$("contactModal").close());
  $("btnCancelContact").addEventListener("click", ()=>$("contactModal").close());
  $("btnSaveContact").addEventListener("click", partnerSaveContact);
  $("btnCloseContentBank").addEventListener("click", ()=>$("contentBankModal").close());
  $("btnSaveContent").addEventListener("click", partnerSaveContent);
  $("btnNewContent").addEventListener("click", partnerClearContentForm);
  $("contentSearch").addEventListener("input", partnerRenderContents);
  $("contentStatusFilter").addEventListener("change", partnerRenderContents);
  $("contentList").addEventListener("click", event=>{
    const button = event.target.closest("[data-content-edit]");
    if(button) partnerEditContent(button.dataset.contentEdit);
  });
}

function partnerSelectFormTab(tab){
  $("partnerFormTabs").querySelectorAll("button").forEach(button=>button.classList.toggle("active", button.dataset.partnerFormTab===tab));
  $("form").querySelectorAll("[data-partner-group]").forEach(section=>{ section.hidden = section.dataset.partnerGroup !== tab; });
}
function partnerSelectedTags(){ return Array.from($("partnerInterestTags").querySelectorAll("input:checked")).map(input=>input.value); }
function partnerSetSelectedTags(tags){
  const selected = new Set(Array.isArray(tags) ? tags : []);
  $("partnerInterestTags").querySelectorAll("input").forEach(input=>{ input.checked = selected.has(input.value); });
}
function partnerPopulateFields(record){
  $("partnerClassification").value = PARTNER_CLASSIFICATIONS.includes(record?.partner_classification) ? record.partner_classification : "Não classificado";
  $("relationshipLevel").value = RELATIONSHIP_LEVELS.includes(record?.relationship_level) ? record.relationship_level : "Novo";
  $("partnerOrigin").value = record?.partner_origin || "";
  $("partnerRegion").value = record?.region || "";
  $("firstVisitAt").value = record?.first_visit_at ? inputDateValue(new Date(record.first_visit_at)) : "";
  $("partnerClientProfile").value = record?.client_profile || "";
  $("partnerProjectProfile").value = record?.project_profile || "";
  $("preferredStyles").value = (record?.preferred_styles || []).join(", ");
  $("preferredEnvironments").value = (record?.preferred_environments || []).join(", ");
  $("currentSuppliers").value = record?.current_suppliers || "";
  $("valuedDifferentials").value = record?.valued_differentials || "";
  $("partnerObjections").value = record?.objections || "";
  $("mentionedProjects").value = record?.mentioned_projects || "";
  partnerSetSelectedTags(record?.interest_tags || []);
  $("cadenceActive").value = String(Boolean(record?.cadence_active));
  $("cadenceType").value = ["Manual","Inicial 90 dias","Estratégico","Potencial","Relacionamento"].includes(record?.cadence_type) ? record.cadence_type : "Manual";
  $("cadenceStartedAt").value = record?.cadence_started_at ? inputDateValue(new Date(record.cadence_started_at)) : "";
  $("nextActionOwner").innerHTML = partnerOwnerOption(record?.next_action_owner || record?.owner_id || session?.user?.id);
  $("activateInitialCadence").checked = true;
  partnerUpdateCadenceActivation(record);
  partnerRenderTimeline(record);
}
function partnerUpdateCadenceActivation(record=null){
  const shouldOffer = $("recordType").value === "specifier" && $("stage").value === "Visitou a loja" && !record?.cadence_active;
  $("cadenceActivation").hidden = !shouldOffer;
  if(shouldOffer && !$("firstVisitAt").value) $("firstVisitAt").value = inputDateValue(new Date());
}
function partnerFormPayload(existing){
  return {
    partner_classification:$("partnerClassification").value,
    relationship_level:$("relationshipLevel").value,
    first_visit_at:$("firstVisitAt").value ? localScheduleIso($("firstVisitAt").value, "12:00") : null,
    region:$("partnerRegion").value.trim() || null,
    project_profile:$("partnerProjectProfile").value.trim() || null,
    client_profile:$("partnerClientProfile").value.trim() || null,
    preferred_styles:partnerCsv($("preferredStyles").value),
    preferred_environments:partnerCsv($("preferredEnvironments").value),
    current_suppliers:$("currentSuppliers").value.trim() || null,
    valued_differentials:$("valuedDifferentials").value.trim() || null,
    objections:$("partnerObjections").value.trim() || null,
    mentioned_projects:$("mentionedProjects").value.trim() || null,
    interest_tags:partnerSelectedTags(),
    partner_origin:$("partnerOrigin").value.trim() || null,
    cadence_type:$("cadenceType").value,
    cadence_active:$("cadenceActive").value === "true",
    cadence_started_at:$("cadenceStartedAt").value ? localScheduleIso($("cadenceStartedAt").value, "12:00") : null,
    next_action_owner:$("nextActionOwner").value || existing?.owner_id || null,
    no_next_action_reason:existing?.no_next_action_reason || null
  };
}

function partnerAskNoNextAction(){
  return new Promise(resolve=>{
    const dialog = $("nextActionWarning");
    $("nextActionReasonWrap").hidden = true;
    $("nextActionReason").value = "";
    const handler = event=>{
      const button = event.target.closest("[data-next-decision]");
      if(!button) return;
      const decision = button.dataset.nextDecision;
      if(decision === "justify" && $("nextActionReasonWrap").hidden){
        $("nextActionReasonWrap").hidden = false;
        $("nextActionReason").focus();
        return;
      }
      if(decision === "justify" && !$("nextActionReason").value.trim()) return toast("Informe a justificativa.");
      dialog.removeEventListener("click", handler);
      dialog.close();
      resolve({decision, reason:$("nextActionReason").value.trim()});
    };
    dialog.addEventListener("click", handler);
    dialog.showModal();
  });
}

function partnerTimelineItems(record){
  if(!record) return [];
  const items = [];
  recordEvents.filter(event=>event.record_id===record.id).forEach(event=>items.push({
    at:event.occurred_at, type:event.event_type, title:({created:"Cadastro",stage_changed:"Mudança de etapa",followup_scheduled:"Compromisso criado",contact_logged:"Contato realizado",classification_changed:"Classificação alterada",relationship_changed:"Nível de relacionamento alterado",cadence_activated:"Cadência ativada",cadence_paused:"Cadência pausada",owner_changed:"Responsável alterado"})[event.event_type] || event.event_type,
    detail:event.to_value || ""
  }));
  (record.interactions || []).forEach(item=>items.push({at:item.at, type:item.result==="Oportunidade identificada"?"opportunity":item.result==="Projeto recebido"?"project_received":"contact_logged", title:`${item.result || "Contato"} • ${item.channel || ""}`, detail:item.summary || item.objective || ""}));
  (record.sent_contents || []).forEach(item=>items.push({at:item.sent_at, type:"content_sent", title:`Conteúdo enviado • ${item.title || "Conteúdo"}`, detail:item.notes || item.channel || ""}));
  normalizeAppointments(record).forEach(item=>items.push({at:item.completed_at || item.starts_at, type:item.status==="completed"?"appointment_completed":"followup_scheduled", title:`${item.status==="completed"?"Compromisso concluído":"Compromisso"} • ${item.kind}`, detail:item.details || ""}));
  return items.filter(item=>item.at).sort((a,b)=>new Date(b.at)-new Date(a.at));
}
function partnerRenderTimeline(record){
  if(!$("partnerTimeline")) return;
  const filter = $("timelineFilter").value;
  const groups = {contacts:["contact_logged"],appointments:["followup_scheduled","appointment_completed"],contents:["content_sent"],stages:["stage_changed"],opportunities:["opportunity","project_received"]};
  const items = partnerTimelineItems(record).filter(item=>filter==="all" || (groups[filter] || []).includes(item.type));
  $("partnerTimeline").innerHTML = items.length ? items.slice(0,100).map(item=>`<div class="timelineItem"><time>${escapeHtml(fmtBRDateTime(item.at))}</time><div><b>${escapeHtml(item.title)}</b>${item.detail?`<p>${escapeHtml(item.detail)}</p>`:""}</div></div>`).join("") : `<div class="empty">O histórico aparecerá conforme o relacionamento for registrado.</div>`;
}

const baseNormalizeAppointments = normalizeAppointments;
normalizeAppointments = function(record){
  return baseNormalizeAppointments(record).map((item,index)=>partnerNormalizeAppointment({...(Array.isArray(record?.appointments) ? record.appointments[index] : {}), ...item}));
};
const baseOpenModal = openModal;
openModal = function(record=null, options={}){
  baseOpenModal(record, options);
  const specifier = $("recordType").value === "specifier";
  $("partnerFormTabs").hidden = !specifier;
  document.querySelectorAll(".partnerOnly").forEach(section=>section.hidden = true);
  if(specifier){
    $("modalTitle").textContent = record ? "Detalhes do parceiro" : "Novo parceiro";
    document.querySelector(".appointmentComposerTitle").textContent = "Agenda de relacionamento";
    document.querySelector(".whatsappWorkspaceTitle").textContent = "WhatsApp do parceiro";
    partnerPopulateFields(record);
    partnerSelectFormTab(options.focusSchedule ? "relationship" : "basic");
  }else{
    $("form").querySelectorAll("[data-partner-group]:not(.partnerOnly)").forEach(section=>section.hidden=false);
    document.querySelector(".appointmentComposerTitle").textContent = "Compromissos do cliente";
    document.querySelector(".whatsappWorkspaceTitle").textContent = "WhatsApp do cliente";
  }
};
const baseUpdateModalMode = updateModalMode;
updateModalMode = function(kind){
  baseUpdateModalMode(kind);
  const specifier = kind === "specifier";
  $("partnerFormTabs").hidden = !specifier;
  if(!specifier){
    document.querySelectorAll(".partnerOnly").forEach(section=>section.hidden=true);
    $("form").querySelectorAll("[data-partner-group]:not(.partnerOnly)").forEach(section=>section.hidden=false);
  }
};
$("stage").addEventListener("change", ()=>partnerUpdateCadenceActivation(records.find(record=>record.id===$("id").value)));

const baseUpsertFromForm = upsertFromForm;
upsertFromForm = async function(){
  if($("recordType").value !== "specifier") return baseUpsertFromForm();
  const existing = records.find(record=>record.id===$("id").value) || null;
  if($("nextAction").value) addAppointmentFromComposer({silent:true});
  const shouldActivate = $("stage").value === "Visitou a loja" && $("activateInitialCadence").checked && !existing?.cadence_active;
  if(shouldActivate){
    const baseDate = $("firstVisitAt").value ? localScheduleIso($("firstVisitAt").value, "12:00") : nowISO();
    appointmentDrafts.push(...partnerCreateInitialCadence({...(existing||{}), appointments:appointmentDrafts}, baseDate, $("partnerClassification").value, $("owner").value));
    $("cadenceActive").value = "true";
    $("cadenceType").value = "Inicial 90 dias";
    $("cadenceStartedAt").value = inputDateValue(new Date(baseDate));
  }
  if(!shouldActivate && $("cadenceActive").value === "true" && $("cadenceType").value === "Inicial 90 dias" && $("partnerClassification").value === "A — Estratégico"){
    const start = $("cadenceStartedAt").value ? localScheduleIso($("cadenceStartedAt").value, "12:00") : (existing?.cadence_started_at || existing?.first_visit_at || nowISO());
    appointmentDrafts.push(...partnerCreateInitialCadence({...(existing||{}),appointments:appointmentDrafts}, start, "A — Estratégico", $("owner").value));
  }
  if($("cadenceActive").value === "true" && PERMANENT_CADENCES[$("cadenceType").value] && !appointmentDrafts.some(item=>item.status==="scheduled" && item.starts_at)){
    const cadenceRecord = {...(existing||{}),cadence_type:$("cadenceType").value,owner_id:$("owner").value,cadence_cycle:Number(existing?.cadence_cycle||0)};
    const nextPermanent = partnerNextPermanentAppointment(cadenceRecord, nowISO());
    if(nextPermanent) appointmentDrafts.push(nextPermanent);
  }
  const hasScheduled = appointmentDrafts.some(item=>item.status==="scheduled" && item.starts_at);
  let reason = existing?.no_next_action_reason || null;
  if(partnerNeedsNextAction({stage:$("stage").value}) && !hasScheduled){
    const decision = await partnerAskNoNextAction();
    if(decision.decision === "cancel") return false;
    if(decision.decision === "create"){
      partnerSelectFormTab("relationship");
      $("nextAction").focus();
      return false;
    }
    reason = decision.reason;
  }
  if(!(await baseUpsertFromForm())) return false;
  const id = $("id").value;
  const payload = partnerFormPayload(existing);
  payload.no_next_action_reason = hasScheduled ? null : reason;
  if(shouldActivate){
    payload.cadence_active = true;
    payload.cadence_type = "Inicial 90 dias";
    payload.cadence_started_at = payload.first_visit_at || nowISO();
    payload.cadence_cycle = 1;
    payload.cadence_history = [...(existing?.cadence_history || []), {at:nowISO(), action:"activated", type:"Inicial 90 dias", actor_id:session.user.id}];
  }
  const {data,error} = await sb.from(TBL_RECORDS).update(payload).eq("id", id).select("*").single();
  if(error){ console.error("[CRM Parceiros] Erro ao salvar campos de relacionamento.", error); toast("Cadastro salvo, mas os campos de relacionamento exigem a nova migração."); return false; }
  const index = records.findIndex(record=>record.id===id);
  if(index>=0) records[index]=data;
  return true;
};

const baseDatasetForTab = datasetForTab;
datasetForTab = function(){
  let data = baseDatasetForTab();
  if(currentTab !== "specifiers") return data;
  const legacyStages = {"Primeiro Contato":"Contato iniciado","Parceiro Ativo":"Parceiro ativo","Pausado":"Adormecido"};
  data.forEach(record=>{ if(legacyStages[record.stage]) record.stage = legacyStages[record.stage]; });
  if(filters.partnerClassification!=="Todos") data=data.filter(r=>(r.partner_classification||"Não classificado")===filters.partnerClassification);
  if(filters.relationshipLevel!=="Todos") data=data.filter(r=>(r.relationship_level||"Novo")===filters.relationshipLevel);
  if(filters.cadence!=="Todos") data=data.filter(r=>Boolean(r.cadence_active)===(filters.cadence==="Ativa"));
  if(filters.opportunity!=="Todos") data=data.filter(r=>partnerHasOpportunity(r)===(filters.opportunity==="Com oportunidade"));
  if(filters.attention==="Sem próxima ação") data=data.filter(r=>!getNextActionAt(r));
  if(filters.attention==="Contato vencido") data=data.filter(r=>{const d=getNextActionAt(r);return d && d<new Date();});
  if(filters.attention==="Adormecidos") data=data.filter(r=>r.stage==="Adormecido");
  return data;
};

const baseRenderKPIs = renderKPIs;
renderKPIs = function(scope){
  baseRenderKPIs(scope);
  if(currentTab!=="specifiers"){ $("partnerKpis").hidden=true; return; }
  const now = new Date();
  const metrics = [
    ["Total no filtro",scope.length],
    ["Contatos vencidos",scope.filter(r=>{const d=getNextActionAt(r);return d&&d<now;}).length],
    ["Próximas ações em 7 dias",scope.filter(r=>{const d=getNextActionAt(r);return d&&d>=now&&(d-now)<=7*86400000;}).length],
    ["Sem próxima ação",scope.filter(r=>!getNextActionAt(r)).length],
    ["Oportunidades",scope.filter(r=>r.stage==="Oportunidade identificada").length],
    ["Projetos recebidos",scope.filter(r=>r.stage==="Projeto recebido").length],
    ["Parceiros ativos",scope.filter(r=>r.stage==="Parceiro ativo").length],
    ["Recorrentes",scope.filter(r=>r.relationship_level==="Recorrente").length]
  ];
  $("partnerKpis").hidden=false;
  $("partnerKpis").innerHTML=metrics.map(([label,value])=>`<div class="kpi"><div class="n">${value}</div><div class="t">${escapeHtml(label)}</div></div>`).join("");
};

const baseRenderCard = renderCard;
renderCard = function(record){
  if(!isSpecifier(record)) return baseRenderCard(record);
  const next = getNextActionAt(record);
  const days = partnerDaysWithoutContact(record);
  const classification = record.partner_classification || "Não classificado";
  const level = record.relationship_level || "Novo";
  const schedule = scheduleStatus(record);
  const opportunity = partnerHasOpportunity(record);
  return `<div class="card partnerCard ${stageClass(record.stage||"Mapeado")} grab" draggable="${isMobileLayout()?"false":"true"}" data-id="${escapeHtml(record.id)}">
    <div class="cTop"><div><div class="cName">${escapeHtml(fullName(record))}</div><div class="partnerCompany">${escapeHtml(record.company_name||"Escritório não informado")}</div></div><div class="rightTop"><span class="badge classificationBadge ${classification.startsWith("A")?"classA":classification.startsWith("B")?"classB":classification.startsWith("C")?"classC":""}">${escapeHtml(classification)}</span><button class="dots" type="button" data-menu-btn="${escapeHtml(record.id)}">...</button></div></div>
    <div class="row"><span class="chip">${escapeHtml(record.specifier_type||"Parceiro")}</span><span class="chip muted">${escapeHtml(record.city||"Cidade —")}</span><span class="chip muted">${escapeHtml(profileNameById(record.owner_id))}</span></div>
    <div class="partnerStatusRow"><span>${escapeHtml(level)}</span><span>${days===null?"Sem contato registrado":`${days} dia(s) sem contato`}</span></div>
    <div class="meta">Último contato: <b>${escapeHtml(fmtBRDate(record.last_contact_at))}</b>${next?` • Próxima: <b>${escapeHtml(fmtBRDateTime(next.toISOString()))}</b>`:""}</div>
    <div class="partnerSignals">${record.cadence_active?`<span title="Cadência ativa">Cadência ativa</span>`:""}${opportunity?`<span title="Oportunidade">${record.stage==="Projeto recebido"?"Projeto recebido":"Oportunidade"}</span>`:""}${!next?`<span class="signalWarn">Sem próxima ação</span>`:""}${days>14?`<span class="signalWarn">+14 dias sem contato</span>`:""}</div>
    <div class="scheduleState ${schedule.kind}">${escapeHtml(schedule.label)}</div>
    <div class="menu" data-menu="${escapeHtml(record.id)}"><button type="button" data-act="edit" data-id="${escapeHtml(record.id)}">Abrir parceiro</button><button type="button" data-act="whatsapp" data-id="${escapeHtml(record.id)}">WhatsApp</button><button type="button" data-act="logContact" data-id="${escapeHtml(record.id)}">Registrar contato</button><button type="button" data-act="schedule" data-id="${escapeHtml(record.id)}">Criar compromisso</button></div>
  </div>`;
};

const baseBuildFilters = buildFilters;
buildFilters = function(){
  baseBuildFilters();
  if($("partnerExtraFilters")) $("partnerExtraFilters").hidden = currentTab!=="specifiers";
};
const baseSetTab = setTab;
setTab = function(tab){
  baseSetTab(tab);
  if($("partnerExtraFilters")) $("partnerExtraFilters").hidden = tab!=="specifiers";
  if(tab==="specifiers"){
    $("btnNew").textContent = "+ Novo parceiro";
    $("boardHint").innerHTML = `<div>Nenhum parceiro em relacionamento deve ficar sem uma próxima ação agendada.</div><div></div>`;
  }
};

const baseMoveRecordToStage = moveRecordToStage;
moveRecordToStage = async function(id, stage){
  const record = records.find(item=>item.id===id);
  if(!record || !isSpecifier(record) || stage!=="Visitou a loja" || record.cadence_active) return baseMoveRecordToStage(id, stage);
  const activate = confirm("Ativar a cadência inicial de relacionamento de 90 dias?\n\nOK: ativar • Cancelar: mover sem ativar");
  if(!activate) return baseMoveRecordToStage(id, stage);
  const baseDate = nowISO();
  const appointments = [...normalizeAppointments(record), ...partnerCreateInitialCadence(record, baseDate, record.partner_classification || "Não classificado", record.owner_id)];
  const active = appointments.filter(item=>item.status==="scheduled").sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  const first = active[0] || null;
  const patch = {stage,stage_entered_at:nowISO(),first_visit_at:record.first_visit_at||baseDate,cadence_active:true,cadence_type:"Inicial 90 dias",cadence_started_at:baseDate,cadence_cycle:1,appointments,next_action_at:first?.starts_at||null,next_action:first?inputDateValue(new Date(first.starts_at)):null,next_action_kind:first?.kind||null,next_action_details:first?.details||null,cadence_history:[...(record.cadence_history||[]),{at:nowISO(),action:"activated",type:"Inicial 90 dias",actor_id:session.user.id}]};
  const {error}=await sb.from(TBL_RECORDS).update(patch).eq("id",id);
  if(error){console.error(error);return toast("Não foi possível ativar a cadência. Aplique a nova migração.");}
  await fetchRecords({reason:"cadência inicial",notifyNew:false});
  render();
  toast("Visita registrada e cadência de 90 dias ativada.");
};

const baseRegisterContactNow = registerContactNow;
registerContactNow = async function(record){
  if(!record || !sb || !session?.user) return toast("Sem login.");
  if(!isSpecifier(record)) return baseRegisterContactNow(record);
  await partnerFetchContents();
  $("contactModal").dataset.recordId = record.id;
  $("contactPartnerName").textContent = fullName(record);
  $("contactAt").value = partnerLocalDateTimeValue();
  $("contactOwner").innerHTML = partnerOwnerOption(record.owner_id || session.user.id);
  $("contactChannel").value = "WhatsApp";
  $("contactType").value = ""; $("contactObjective").value = ""; $("contactSummary").value = ""; $("contactProject").value = "";
  $("contactResult").value = "Conversa realizada";
  $("contactNextAction").value = ""; $("contactNextAt").value = "";
  $("contactNextOwner").innerHTML = partnerOwnerOption(record.next_action_owner || record.owner_id || session.user.id);
  const scheduled = scheduledAppointments(record);
  $("relatedAppointment").innerHTML = `<option value="">Nenhum</option>` + scheduled.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.kind)} • ${escapeHtml(fmtBRDateTime(item.starts_at))}</option>`).join("");
  const sent = new Set((record.sent_contents||[]).map(item=>item.content_id));
  const options = partnerContents.filter(item=>item.status==="Ativo");
  $("contactContent").innerHTML = `<option value="">Nenhum</option>` + options.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join("");
  const tags = new Set(record.interest_tags || []);
  const suggestions = options.filter(item=>!sent.has(item.id) && (item.tags||[]).some(tag=>tags.has(tag))).slice(0,4);
  $("contentSuggestions").textContent = suggestions.length ? `Sugestões ainda não enviadas: ${suggestions.map(item=>item.title).join(" • ")}` : "Nenhuma sugestão inédita pelas tags atuais.";
  $("contactModal").showModal();
};

async function partnerSaveContact(){
  const record = records.find(item=>item.id===$("contactModal").dataset.recordId);
  if(!record) return;
  const summary = $("contactSummary").value.trim();
  if(!summary) return toast("Resuma o que aconteceu.");
  const at = new Date($("contactAt").value).toISOString();
  const result = $("contactResult").value;
  let appointments = normalizeAppointments(record);
  const relatedId = $("relatedAppointment").value;
  if(relatedId) appointments = appointments.map(item=>item.id===relatedId?{...item,status:"completed",completed_at:at,completed_by:session.user.id}:item);
  if($("contactNextAt").value){
    appointments.push(partnerNormalizeAppointment({id:crypto.randomUUID(),starts_at:new Date($("contactNextAt").value).toISOString(),kind:$("contactNextAction").value.trim()||"Acompanhamento",details:`Criado após contato: ${summary}`,owner_id:$("contactNextOwner").value||record.owner_id,status:"scheduled",source:"contact_log"}));
  }else if(relatedId && record.cadence_active && PERMANENT_CADENCES[record.cadence_type]){
    const next = partnerNextPermanentAppointment(record, at);
    if(next) appointments.push(next);
  }
  const scheduled = appointments.filter(item=>item.status==="scheduled"&&item.starts_at).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  let reason = null;
  if(partnerNeedsNextAction(record) && !scheduled.length){
    const decision = await partnerAskNoNextAction();
    if(decision.decision==="cancel") return;
    if(decision.decision==="create"){ $("contactNextAt").focus(); return; }
    reason = decision.reason;
  }
  const interaction = {id:crypto.randomUUID(),at,owner_id:$("contactOwner").value,channel:$("contactChannel").value,type:$("contactType").value.trim()||"Contato",objective:$("contactObjective").value.trim()||null,summary,result,project:$("contactProject").value.trim()||null,content_id:$("contactContent").value||null,next_action:$("contactNextAction").value.trim()||null,next_action_at:$("contactNextAt").value?new Date($("contactNextAt").value).toISOString():null};
  const selectedContent = partnerContents.find(item=>item.id===$("contactContent").value);
  const sentContents = [...(record.sent_contents||[])];
  if(selectedContent) sentContents.push({id:crypto.randomUUID(),content_id:selectedContent.id,title:selectedContent.title,sent_at:at,responsible_id:$("contactOwner").value,channel:$("contactChannel").value,notes:summary});
  const stageSuggestion = {"Visita agendada":"Visita agendada","Oportunidade identificada":"Oportunidade identificada","Projeto recebido":"Projeto recebido"}[result];
  let stage = record.stage;
  if(stageSuggestion && stageSuggestion!==stage && confirm(`O resultado sugere mover o parceiro para “${stageSuggestion}”. Deseja alterar a etapa?`)) stage=stageSuggestion;
  const first = scheduled.find(item=>new Date(item.starts_at)>=new Date()) || scheduled[0] || null;
  const payload = {interactions:[...(record.interactions||[]),interaction],sent_contents:sentContents,last_contact_at:at,appointments,stage,stage_entered_at:stage!==record.stage?nowISO():record.stage_entered_at,next_action_at:first?.starts_at||null,next_action:first?inputDateValue(new Date(first.starts_at)):null,next_action_kind:first?.kind||null,next_action_details:first?.details||null,next_action_owner:first?.owner_id||record.owner_id,no_next_action_reason:first?null:reason,owner_id:$("contactOwner").value||record.owner_id};
  if(relatedId && PERMANENT_CADENCES[record.cadence_type]) payload.cadence_cycle=Number(record.cadence_cycle||0)+1;
  const {data,error}=await sb.from(TBL_RECORDS).update(payload).eq("id",record.id).select("*").single();
  if(error){console.error(error);return toast("Erro ao registrar contato.");}
  records[records.findIndex(item=>item.id===record.id)] = data;
  await fetchRecordEvents();
  $("contactModal").close();
  if($("modal").open) closeModal();
  render();
  toast("Contato registrado e acompanhamento atualizado.");
}

async function partnerFetchContents(){
  if(!sb || !session?.user) return [];
  const {data,error}=await sb.from(TBL_PARTNER_CONTENTS).select("*").order("registered_at",{ascending:false});
  if(error){ console.warn("[CRM Parceiros] Banco de conteúdos indisponível.", error); partnerContents=[]; return []; }
  partnerContents=data||[];
  return partnerContents;
}
async function partnerOpenContentBank(){
  await partnerFetchContents();
  partnerClearContentForm(); partnerRenderContents(); $("contentBankModal").showModal();
}
function partnerClearContentForm(){
  $("contentId").value=""; $("contentTitle").value=""; $("contentDescription").value=""; $("contentUrl").value=""; $("contentTags").value=""; $("contentNotes").value=""; $("contentStatus").value="Ativo"; $("contentPillar").value=CONTENT_PILLARS[0]; $("contentFormat").value=CONTENT_FORMATS[0];
}
function partnerRenderContents(){
  const query=($("contentSearch").value||"").toLowerCase(); const status=$("contentStatusFilter").value;
  const data=partnerContents.filter(item=>(status==="Todos"||item.status===status)&&[item.title,item.description,...(item.tags||[])].join(" ").toLowerCase().includes(query));
  $("contentList").innerHTML=data.length?data.map(item=>`<article class="contentCard"><div><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.pillar)} • ${escapeHtml(item.format)} • ${escapeHtml(item.status)}</span></div>${item.description?`<p>${escapeHtml(item.description)}</p>`:""}<div class="row">${(item.tags||[]).map(tag=>`<span class="chip">${escapeHtml(tag)}</span>`).join("")}</div><div class="contentCardActions">${item.external_url?`<a class="btn" href="${escapeHtml(item.external_url)}" target="_blank" rel="noopener noreferrer">Abrir link</a>`:""}<button class="ghost" type="button" data-content-edit="${escapeHtml(item.id)}">Editar</button></div></article>`).join(""):`<div class="empty">Nenhum conteúdo neste filtro. Aplique a migração se o banco ainda não estiver disponível.</div>`;
}
function partnerEditContent(id){
  const item=partnerContents.find(content=>content.id===id); if(!item)return;
  $("contentId").value=item.id; $("contentTitle").value=item.title||""; $("contentPillar").value=item.pillar; $("contentFormat").value=item.format; $("contentDescription").value=item.description||""; $("contentUrl").value=item.external_url||""; $("contentTags").value=(item.tags||[]).join(", "); $("contentStatus").value=item.status; $("contentNotes").value=item.notes||"";
}
async function partnerSaveContent(){
  const title=$("contentTitle").value.trim(); if(!title)return toast("Informe o título do conteúdo.");
  const payload={title,pillar:$("contentPillar").value,format:$("contentFormat").value,description:$("contentDescription").value.trim()||null,external_url:$("contentUrl").value.trim()||null,tags:partnerCsv($("contentTags").value),status:$("contentStatus").value,notes:$("contentNotes").value.trim()||null,created_by:session.user.id};
  const id=$("contentId").value; const query=id?sb.from(TBL_PARTNER_CONTENTS).update(payload).eq("id",id):sb.from(TBL_PARTNER_CONTENTS).insert(payload);
  const {error}=await query; if(error){console.error(error);return toast("Erro ao salvar conteúdo. Verifique a migração.");}
  await partnerFetchContents(); partnerClearContentForm(); partnerRenderContents(); toast("Conteúdo salvo.");
}

const baseRenderReports = renderReports;
renderReports = function(){
  const base = baseRenderReports();
  const partners = records.filter(isSpecifier);
  const interactions = partners.flatMap(record=>(record.interactions||[]).map(item=>({...item,record})));
  const scheduled = partners.flatMap(record=>normalizeAppointments(record));
  const completed = scheduled.filter(item=>item.status==="completed");
  const sent = partners.flatMap(record=>record.sent_contents||[]);
  const countBy = (values,key)=>Object.entries(values.reduce((acc,item)=>{const label=key(item)||"Não informado";acc[label]=(acc[label]||0)+1;return acc;},{})).sort((a,b)=>b[1]-a[1]);
  const stageRows=countBy(partners,r=>r.stage).map(([label,value])=>`<div class="reportRow"><span>${escapeHtml(label)}</span><b>${value}</b></div>`).join("");
  const classRows=countBy(partners,r=>r.partner_classification||"Não classificado").map(([label,value])=>`<div class="reportRow"><span>${escapeHtml(label)}</span><b>${value}</b></div>`).join("");
  const contentRows=countBy(sent,item=>item.title).slice(0,8).map(([label,value])=>`<div class="reportRow"><span>${escapeHtml(label)}</span><b>${value}</b></div>`).join("")||`<div class="empty">Nenhum envio registrado.</div>`;
  const channelRows=countBy(interactions,item=>item.channel).map(([label,value])=>`<div class="reportRow"><span>${escapeHtml(label)}</span><b>${value}</b></div>`).join("")||`<div class="empty">Nenhum contato detalhado registrado.</div>`;
  const metrics=[["Parceiros cadastrados",partners.length],["Sem próxima ação",partners.filter(r=>!getNextActionAt(r)).length],["Ações programadas",scheduled.filter(i=>i.status==="scheduled").length],["Ações concluídas",completed.length],["Taxa de cumprimento",scheduled.length?`${Math.round(completed.length/scheduled.length*100)}%`:"—"],["+14 dias sem contato",partners.filter(r=>partnerDaysWithoutContact(r)>14).length],["+30 dias sem contato",partners.filter(r=>partnerDaysWithoutContact(r)>30).length],["+60 dias sem contato",partners.filter(r=>partnerDaysWithoutContact(r)>60).length],["Oportunidades",partners.filter(r=>r.stage==="Oportunidade identificada").length],["Projetos recebidos",partners.filter(r=>r.stage==="Projeto recebido").length],["Parceiros ativos",partners.filter(r=>r.stage==="Parceiro ativo").length],["Recorrentes",partners.filter(r=>r.relationship_level==="Recorrente").length]];
  return `${base}<section class="partnerReports"><div class="sectionHd"><span>Relacionamento com parceiros</span><span>Dados calculados do CRM</span></div><div class="summaryGrid">${metrics.map(([label,value])=>`<div class="summaryCard"><div class="t">${escapeHtml(label)}</div><div class="n">${value}</div></div>`).join("")}</div><div class="partnerReportColumns"><section class="sectionCard"><div class="sectionHd"><span>Por etapa</span></div><div class="sectionBody">${stageRows||`<div class="empty">Sem parceiros.</div>`}</div></section><section class="sectionCard"><div class="sectionHd"><span>Por classificação</span></div><div class="sectionBody">${classRows||`<div class="empty">Sem parceiros.</div>`}</div></section><section class="sectionCard"><div class="sectionHd"><span>Conteúdos mais utilizados</span></div><div class="sectionBody">${contentRows}</div></section><section class="sectionCard"><div class="sectionHd"><span>Canais utilizados</span></div><div class="sectionBody">${channelRows}</div></section></div></section>`;
};

window.CriarePartners = Object.freeze({
  stages:[...PARTNER_STAGES], initialCadence:[...INITIAL_CADENCE], permanentCadences:PERMANENT_CADENCES,
  adjustedDate:partnerAdjustedDate, createInitialCadence:partnerCreateInitialCadence,
  needsNextAction:partnerNeedsNextAction, daysWithoutContact:partnerDaysWithoutContact
});
partnerInjectInterface();
