/* Criare Mogi Guaçu — atividades realizadas, separadas da agenda. */
(function(root){
  'use strict';
  const timeZone = 'America/Sao_Paulo';
  const types = Object.freeze({
    phone_answered:{label:'Ligação atendida',channel:'Ligação',result:'Conversa realizada'},
    phone_unanswered:{label:'Ligação não atendida',channel:'Ligação',result:'Sem resposta'},
    whatsapp:{label:'Contato por WhatsApp',channel:'WhatsApp',result:'Contato registrado'},
    showroom:{label:'Visita ao showroom',channel:'Reunião na loja',result:'Visita realizada'},
    office_visit:{label:'Visita ao escritório',channel:'Visita ao escritório',result:'Visita realizada'},
    meeting:{label:'Reunião realizada',channel:'Reunião',result:'Conversa realizada'},
    presentation:{label:'Apresentação de projeto',channel:'Apresentação',result:'Apresentação realizada'},
    email:{label:'E-mail enviado',channel:'E-mail',result:'Mensagem enviada'},
    other:{label:'Outra atividade',channel:'Outro',result:'Atividade realizada'}
  });
  function dateKey(value){
    if(!value || !Number.isFinite(new Date(value).getTime())) return '';
    return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  }
  function dateTimeInput(value=new Date()){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
    const p=Object.fromEntries(parts.map(v=>[v.type,v.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  function inputToIso(value){
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value||'')) throw new Error('Informe uma data e um horário válidos.');
    const date=new Date(`${value}:00-03:00`);
    if(!Number.isFinite(date.getTime()) || dateTimeInput(date)!==value) throw new Error('Informe uma data e um horário válidos.');
    return date.toISOString();
  }
  function validateActivity(input,now=Date.now()){
    if(!types[input.activity_type]) throw new Error('Escolha a atividade realizada.');
    if(!String(input.summary||'').trim()) throw new Error('Descreva brevemente o que aconteceu.');
    if(String(input.summary).trim().length>5000) throw new Error('Use até 5.000 caracteres na descrição.');
    if(!input.at || !Number.isFinite(new Date(input.at).getTime())) throw new Error('Informe a data da atividade.');
    if(new Date(input.at).getTime()>now+300000) throw new Error('Atividades realizadas não podem ter data futura. Use a próxima ação para agendar.');
    return {...input,summary:input.summary.trim()};
  }
  function entries(records){
    const result=[],seen=new Set();
    for(const record of records||[]){
      for(const [index,item] of (Array.isArray(record.interactions)?record.interactions:[]).entries()){
        if(!item || typeof item!=='object') continue;
        const key=`${record.id}:${item.id||`legacy-${index}`}`;
        if(seen.has(key)) continue;
        seen.add(key);
        result.push({...item,id:key,record_id:record.id,name:[record.first_name,record.last_name].filter(Boolean).join(' '),
          entity_type:record.record_type==='specifier'?'specifier':'lead',day:dateKey(item.at),
          activity_type:item.activity_type||'legacy',label:types[item.activity_type]?.label||item.type||item.channel||'Contato anterior',
          performer_id:item.performed_by||item.owner_id||'',summary:item.summary||item.objective||'',legacy:!item.activity_type});
      }
    }
    return result.sort((a,b)=>(new Date(b.at).getTime()||0)-(new Date(a.at).getTime()||0));
  }
  function report(records,filters={}){
    const all=entries(records),rows=all.filter(item=>item.day && (!filters.start||item.day>=filters.start) && (!filters.end||item.day<=filters.end) && (!filters.owner||item.performer_id===filters.owner) && (!filters.entity||item.entity_type===filters.entity) && (!filters.type||item.activity_type===filters.type));
    const days=new Map(),byOwner=new Map(),byType=new Map();
    for(const row of rows){
      const day=days.get(row.day)||{day:row.day,total:0,leads:0,partners:0,unanswered:0};
      day.total++; day[row.entity_type==='specifier'?'partners':'leads']++;
      if(row.activity_type==='phone_unanswered') day.unanswered++;
      days.set(row.day,day);
      byOwner.set(row.performer_id,(byOwner.get(row.performer_id)||0)+1);
      byType.set(row.label,(byType.get(row.label)||0)+1);
    }
    return {rows,total:rows.length,contacts:new Set(rows.map(r=>r.record_id)).size,undated:all.filter(r=>!r.day).length,
      days:[...days.values()].sort((a,b)=>b.day.localeCompare(a.day)),byOwner:[...byOwner],byType:[...byType]};
  }
  function csv(rows,profileName=id=>id){
    const cell=value=>'"'+String(value??'').replace(/^[\s]*[=+@-]/,v=>"'"+v).replaceAll('"','""')+'"';
    return '\uFEFF'+[['Data e hora (São Paulo)','Cadastro','Tipo de cadastro','Atividade','Realizada por','Resultado','Descrição'],...rows.map(r=>[dateTimeInput(r.at).replace('T',' '),r.name,r.entity_type==='specifier'?'Professional Partners':'Lead / cliente',r.label,profileName(r.performer_id)||'PENDENTE DE CONFIRMAÇÃO',r.result||'',r.summary])].map(row=>row.map(cell).join(';')).join('\r\n');
  }
  root.CriareActivityLog=Object.freeze({types,timeZone,dateKey,dateTimeInput,inputToIso,validateActivity,entries,report,csv});
})(globalThis);
