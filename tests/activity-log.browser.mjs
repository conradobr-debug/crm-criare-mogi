// Isolated browser QA: all backend requests are blocked; only synthetic records.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),out=process.env.QA_OUTPUT||'/private/tmp/criare-activity-qa';
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  try{const pathname=new URL(req.url,'http://localhost').pathname;let file=path.join(root,pathname==='/'?'index.html':decodeURIComponent(pathname));if(!file.startsWith(root)){res.writeHead(403).end();return;}
    let data=await readFile(file);if(file.endsWith('index.html'))data=data.toString().replace(/\/\* Boot \*\/[\s\S]*?<\/script>/,'</script>').replace(/<script src="https:[^"]+"><\/script>/g,'');
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(data);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/Sao_Paulo'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(()=>{
    const uid='00000000-0000-4000-8000-000000000101';
    profiles=[{id:uid,display_name:'Pessoa de teste'},{id:'00000000-0000-4000-8000-000000000102',display_name:'Outra pessoa'}];
    session={user:{id:uid,email:'teste@example.invalid'}};currentWorkspaceRole='admin';appDataState='ready';
    records=[{id:'00000000-0000-4000-8000-000000000201',first_name:'Cliente',last_name:'Teste',phone:'+5519999990001',city:'Mogi Guaçu',rooms:'Cozinha',record_type:'lead',pipeline:'lead',stage:'Novo',created_at:new Date().toISOString(),stage_entered_at:new Date().toISOString(),owner_id:uid,owner_ids:[uid],appointments:[],interactions:[],notes:'NOTA ORIGINAL: visita anterior à loja.'},{id:'00000000-0000-4000-8000-000000000202',first_name:'Parceiro',last_name:'Teste',phone:'+5519999990002',city:'Mogi Guaçu',record_type:'specifier',pipeline:'lead',stage:'Mapeado',created_at:new Date().toISOString(),stage_entered_at:new Date().toISOString(),owner_id:uid,owner_ids:[uid],appointments:[],interactions:[],notes:'NOTA ORIGINAL DO PARCEIRO'}];
    loadOfficialWhatsApp=async()=>{};persistLegacyWhatsAppNormalization=async(a,b)=>b;fetchRecordEvents=async()=>{};window.rpcCalls=[];
    const emptyQuery=new Proxy({}, {get:(_,key)=>key==='then'?(resolve=>resolve({data:[],error:null})):(()=>emptyQuery)});
    sb={from:()=>{
      let patch=null,id=null;const query={select(){return this;},order(){return this;},eq(k,v){if(k==='id')id=v;return this;},update(value){patch=value;return this;},async single(){return {data:{...records.find(r=>r.id===id),...patch},error:null};},then(resolve){return resolve({data:[],error:null});}};return query;
    },rpc:async(fn,args)=>{window.rpcCalls.push(args);if(window.failNextRpc){window.failNextRpc=false;return {error:{message:'Falha de conexão simulada'}};}
      const original=records.find(r=>r.id===args.p_record_id),saved=structuredClone(original),a=args.p_activity;
      if(!saved.interactions.some(i=>i.id===a.id)){saved.interactions.push({...a,recorded_by:uid,recorded_at:new Date().toISOString(),result:CriareActivityLog.types[a.activity_type].result});if(args.p_next_action)saved.appointments.push({id:crypto.randomUUID(),...args.p_next_action,kind:'Follow-up',status:'scheduled'});}
      return {data:saved,error:null};
    }};
    openModal(records[0]);
  });
  await page.locator('#btnQuickActivity').click();
  await page.locator('[data-activity-type="phone_unanswered"]').click();
  await page.locator('#quickActivitySummary').fill('Liguei, mas o cliente não atendeu.');
  await page.locator('#quickActivityNext').fill('Tentar ligar novamente');
  await page.locator('[data-activity-next-days="1"]').click();
  await page.screenshot({path:path.join(out,'registro-atividade-desktop.png'),fullPage:true});
  await page.locator('#btnSaveQuickActivity').click();
  await page.waitForFunction(()=>!document.querySelector('#quickActivityDialog').open);
  assert.match(await page.locator('#activityLogHistory').innerText(),/Ligação não atendida/);
  assert.equal(await page.locator('#notes').inputValue(),'NOTA ORIGINAL: visita anterior à loja.');
  assert.match(await page.locator('#appointmentList').innerText(),/Tentar ligar novamente/);
  await page.locator('#nextActionDetails').fill('Rascunho ainda não salvo');
  await page.locator('#btnQuickActivity').click();
  await page.locator('#quickActivitySummary').fill('Segundo registro');
  await page.evaluate(()=>{window.failNextRpc=true;});
  await page.locator('#btnSaveQuickActivity').click();
  assert.match(await page.locator('#quickActivityError').innerText(),/Falha de conexão/);
  assert.equal(await page.locator('#quickActivitySummary').inputValue(),'Segundo registro');
  await page.locator('#btnSaveQuickActivity').click();
  await page.waitForFunction(()=>!document.querySelector('#quickActivityDialog').open);
  assert.equal(await page.locator('#nextActionDetails').inputValue(),'Rascunho ainda não salvo');
  await page.locator('#nextAction').fill(await page.evaluate(()=>CriareActivityLog.dateKey(new Date(Date.now()+2*86400000))));
  await page.locator('#btnAddAppointment').click();
  await page.locator('#btnSave').click();
  await page.waitForFunction(()=>!document.querySelector('#modal').open);
  assert.equal(await page.evaluate(()=>records[0].appointments.some(a=>a.details==='Rascunho ainda não salvo')),true);
  const retryIds=await page.evaluate(()=>window.rpcCalls.slice(-2).map(r=>r.p_activity.id));assert.equal(retryIds[0],retryIds[1]);
  await page.evaluate(()=>{closeModal();openModal(records[1]);});
  assert.equal(await page.locator('#btnQuickActivity').isVisible(),true);
  await page.locator('#btnQuickActivity').click();
  await page.locator('[data-activity-type="showroom"]').click();
  await page.locator('#quickActivitySummary').fill('Conheceu o showroom e os acabamentos.');
  await page.locator('#btnSaveQuickActivity').click();
  await page.waitForFunction(()=>!document.querySelector('#quickActivityDialog').open);
  assert.match(await page.locator('#activityLogHistory').innerText(),/Visita ao showroom/);
  assert.equal(await page.locator('#notes').inputValue(),'NOTA ORIGINAL DO PARCEIRO');
  await page.screenshot({path:path.join(out,'historico-parceiro-desktop.png'),fullPage:true});
  await page.evaluate(()=>{closeModal();setTab('reports');});
  await page.locator('[data-activity-period="today"]').click();
  assert.match(await page.locator('.followupTotals').innerText(),/3 atividade/);
  await page.locator('#activityReportEntity').selectOption('specifier');
  assert.match(await page.locator('.followupTotals').innerText(),/1 atividade/);
  await page.locator('#activityReportEntity').selectOption('');
  await page.locator('#activityReportType').selectOption('phone_unanswered');
  assert.match(await page.locator('.followupTotals').innerText(),/1 atividade/);
  await page.locator('#activityReportType').selectOption('');
  assert.ok((await page.locator('#dailyActivityReport').boundingBox()).width>1100);
  await page.screenshot({path:path.join(out,'relatorio-desktop.png'),fullPage:true});
  const downloadEvent=page.waitForEvent('download');await page.locator('#btnActivityCsv').click();const download=await downloadEvent;assert.match(download.suggestedFilename(),/criare-atividades/);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>openModal(records[0]));await page.locator('#btnQuickActivity').click();
  await page.screenshot({path:path.join(out,'registro-atividade-mobile.png'),fullPage:true});
  assert.equal(await page.locator('#quickActivityDialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
  assert.deepEqual(errors,[]);
  console.log('Browser QA passed: leads, partners, notes, scheduling, retry, unsaved draft, history, date/type/entity report filters, CSV, desktop/mobile, no page errors.');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
