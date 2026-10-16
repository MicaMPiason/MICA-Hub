import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser,sleep,waitFor } from './helpers/browser.mjs';
import { crmFixture } from './fixtures/crm.mjs';
const fixture=crmFixture(8),legacy=['a_prospectar','tentando_contato','conversou','reuniao_agendada','proposta_enviada','negociacao','fechado','perdido'];
legacy.forEach((stage,index)=>{fixture.records['fixture-'+index]={stage,history:[],attempts:0,negotiation:{closedValue:stage==='fechado'?900:'',lossReason:stage==='perdido'?'Sem interesse':''}};});
const exceptions=[],harness=await launchBrowser({document:fixture,exceptions}),{cdp}=harness;
let passed=0;
const quote=JSON.stringify,screens=process.env.MICA_PIPELINE_SCREENSHOTS;
if(screens)mkdirSync(screens,{recursive:true});
async function check(name,expression){assert(await cdp.evaluate(expression),name);passed++;}
async function click(selector){await cdp.evaluate(`document.querySelector(${quote(selector)}).click()`);await sleep(50);}
async function fill(values,formId='pipeline-move-form'){
  await cdp.evaluate(`(() => {const form=document.getElementById(${quote(formId)});for(const [key,value] of Object.entries(${quote(values)})){const control=form.elements[key];if(!control)throw new Error('Missing field '+key);control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
}
async function submit(form='pipeline-move-form'){await cdp.evaluate(`document.getElementById(${quote(form)}).requestSubmit()`);assert(await waitFor(cdp,`!document.getElementById(${quote(form)})`,6000),'Form confirmation');}
async function move(destination,fields={}){await click('[data-action="pipeline-move"][data-id="fixture-0"]');await fill({destination,...fields});await submit();}
async function capture(name){if(!screens)return;await sleep(3400);await cdp.evaluate(`window.scrollTo(0,0);document.getElementById('view-root').scrollTop=0`);const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(screens,name+'.png'),Buffer.from(shot.data,'base64'));}
try{
  assert(await waitFor(cdp,`!!document.querySelector('.metrics-grid')`),'Hub starts');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  await click('[data-view="pipeline"]');
  await check('Quatro colunas operacionais',`document.querySelectorAll('.pipeline-column').length===4&&document.querySelectorAll('.pipeline-card').length===6`);
  await check('Mapeamento preserva IDs, histórico e classificações antigas',`Object.keys(window.MicaData.load().records).length===8&&Object.values(window.MicaData.load().records).every(record=>record.history.length===0&&record.pipeline.legacyStage)`);
  await capture('pipeline-desktop');
  await cdp.evaluate(`(() => {const transfer=new DataTransfer(),card=document.querySelector('[data-drag-id="fixture-0"]'),target=document.querySelector('[data-drop-stage="em_contato"]');card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:transfer}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));})()`);
  await check('Arrastar abre formulário sem persistir a etapa',`!!document.getElementById('pipeline-move-form')&&window.MicaData.load().records['fixture-0'].pipeline.stage==='a_prospectar'`);
  await check('Movimentação protege o foco e exige escolha explícita',`document.querySelector('.app-shell').inert&&document.getElementById('pipeline-move-form').elements.substatus.required&&!document.getElementById('pipeline-move-form').elements.substatus.value`);
  await click('[data-modal-close]');
  await check('Cancelar preserva etapa e histórico',`window.MicaData.load().records['fixture-0'].history.length===0&&!!document.querySelector('[data-drop-stage="a_prospectar"] [data-drag-id="fixture-0"]')`);
  await check('Cancelar libera novamente a interface',`!document.querySelector('.app-shell').inert`);
  await click('[data-action="pipeline-move"][data-id="fixture-0"]');
  await fill({destination:'em_contato',substatus:'WhatsApp enviado',note:'Primeira abordagem'});
  await cdp.evaluate(`window.__commercialWriteDelay=400;document.getElementById('pipeline-move-form').requestSubmit();document.getElementById('pipeline-move-form').requestSubmit()`);
  await check('Movimentação espera confirmação e impede duplo envio',`window.MicaData.load().records['fixture-0'].pipeline.stage==='a_prospectar'&&document.querySelector('button[form="pipeline-move-form"]').disabled`);
  assert(await waitFor(cdp,`!document.getElementById('pipeline-move-form')`));
  await cdp.evaluate(`window.__commercialWriteDelay=0`);
  await check('Etapa e WhatsApp são persistidos sem duplicações',`(() => {const record=window.MicaData.load().records['fixture-0'];return record.pipeline.stage==='em_contato'&&record.pipeline.substatus==='WhatsApp enviado'&&record.history.filter(event=>event.type==='stage').length===1&&record.history.filter(event=>event.type==='whatsapp').length===1&&record.history.every(event=>event.userId==='fixture-user')})()`);
  await click('[data-action="commercial-activity"][data-id="fixture-0"]');
  await fill({type:'call',result:'Não atendeu',note:'Tentar novamente',nextType:'Ligar',nextDate:'2030-01-01'},'commercial-activity-form');
  await cdp.evaluate(`window.__failCommercialWrite=true;document.getElementById('commercial-activity-form').requestSubmit()`);
  assert(await waitFor(cdp,`document.querySelector('[data-commercial-error]').textContent.includes('Simulated')`));
  await check('Falha preserva rascunho e não altera o documento',`document.getElementById('commercial-activity-form').elements.note.value==='Tentar novamente'&&window.MicaData.load().records['fixture-0'].attempts===0`);
  await cdp.evaluate(`window.__failCommercialWrite=false`);await submit('commercial-activity-form');
  await check('Atividade mantém a etapa, cria retorno e atualiza substatus',`(() => {const record=window.MicaData.load().records['fixture-0'];return record.pipeline.stage==='em_contato'&&record.pipeline.substatus==='Não atendeu'&&record.attempts===1&&record.nextAction.date==='2030-01-01'&&record.history.filter(event=>event.type==='stage').length===1})()`);
  await move('oportunidades',{substatus:'Reunião agendada',meetingDate:'2030-02-01',meetingTime:'14:00',meetingPlace:'Google Meet'});
  await check('Reunião contextual agenda próxima ação',`window.MicaData.load().records['fixture-0'].nextAction.type==='Reunião'&&window.MicaData.load().records['fixture-0'].nextAction.note.includes('Google Meet')`);
  await move('propostas',{substatus:'Negociando valores',proposalValue:'1500',note:'Revisar valor'});
  await check('Proposta mantém valor e substatus',`window.MicaData.load().records['fixture-0'].negotiation.proposedValue===1500&&window.MicaData.load().records['fixture-0'].pipeline.substatus==='Negociando valores'`);
  await move('fechado',{service:'Site institucional',value:'1500',recurring:'50'});
  await check('Fechamento grava receita e negócio atomicamente',`(() => {const state=window.MicaData.load();return state.records['fixture-0'].pipeline.closure.recurring===50&&state.financial.transactions.filter(item=>item.leadId==='fixture-0'&&item.amount===1500).length===1})()`);
  await click('[data-pipeline-mode="finished"]');
  await check('Finalizados separa ganhos de perdas',`document.querySelectorAll('.finalized-card').length===2&&!document.querySelector('.finalized-card .badge.danger')`);
  await click('[data-final-result="perdido"]');
  await check('Perdidos têm lista própria',`document.querySelectorAll('.finalized-card').length===1&&!document.querySelector('.finalized-card .badge.success')`);
  await click('[data-final-result="fechado"]');await click('[data-action="pipeline-reopen"][data-id="fixture-0"]');await fill({destination:'oportunidades',substatus:'Aguardando decisão'});await submit();
  await check('Reabertura preserva histórico, receita e fechamento anterior',`(() => {const state=window.MicaData.load(),record=state.records['fixture-0'];return record.pipeline.previousClosures[0].value===1500&&record.history.some(event=>event.type==='reopen')&&state.financial.transactions.filter(item=>item.leadId==='fixture-0').length===1})()`);
  await click('[data-pipeline-mode="board"]');await click('[data-pipeline-mode="queue"]');
  await check('Fila exclui finalizados e inclui oportunidades sem ação',`!document.querySelector('[data-drag-id="fixture-6"]')&&!document.querySelector('[data-drag-id="fixture-7"]')&&!!document.querySelector('[data-drag-id="fixture-0"]')`);
  await click('[data-pipeline-mode="board"]');
  await cdp.evaluate(`(() => {const select=document.querySelector('[data-filter-field="substatus"]');select.value='Aguardando decisão';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await check('Filtro de substatus utiliza a nova classificação',`document.querySelectorAll('.pipeline-card').length===1`);
  await cdp.evaluate(`(() => {const select=document.querySelector('[data-filter-field="substatus"]');select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));const search=document.getElementById('global-search');search.value='Aguardando decisão';search.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert(await waitFor(cdp,`document.querySelectorAll('.pipeline-card').length===1`));passed++;
  await click('[data-action="clear-search"]');
  for(const [width,height] of [[390,844],[900,768],[1600,1000]]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(300);
    await check('Página não transborda em '+width,`document.documentElement.scrollWidth<=innerWidth`);
    if(width===390){await check('Celular exibe uma etapa por vez',`Array.from(document.querySelectorAll('.pipeline-column')).filter(item=>getComputedStyle(item).display!=='none').length===1`);await click('[data-pipeline-tab="oportunidades"]');await check('Navegação móvel abre Oportunidades',`getComputedStyle(document.querySelector('[data-drop-stage="oportunidades"]')).display!=='none'`);}
    if(width===900)await check('Tela média mantém cards legíveis com navegação horizontal local',`document.querySelector('.pipeline-board-shell').scrollWidth>document.querySelector('.pipeline-board-shell').clientWidth&&document.querySelector('.pipeline-card').getBoundingClientRect().width>=240`);
    await capture('pipeline-'+width);
  }
  await click('[data-view="leads"]');await cdp.evaluate(`const select=document.querySelector('[data-stage-id="fixture-0"]');select.value='em_contato';select.dispatchEvent(new Event('change',{bubbles:true}));`);
  await check('Lista de leads abre movimentação contextual',`!!document.getElementById('pipeline-move-form')`);await click('[data-modal-close]');
  await click('[data-open-lead="fixture-0"]');await click('[data-drawer-tab="historico"]');
  await check('Timeline diferencia mudanças, atividades e reaberturas',`document.querySelector('.timeline').textContent.includes('Mudança de etapa')&&document.querySelector('.timeline').textContent.includes('Reabertura')&&document.querySelector('.timeline').textContent.includes('Retorno agendado')`);
  await click('[data-action="close-drawer"]');await click('[data-view="dashboard"]');
  await check('Dashboard preserva metas configuráveis',`document.querySelectorAll('.goal-card').length===4`);
  await click('[data-view="relatorios"]');await check('Relatórios seguem disponíveis',`!!document.querySelector('.report-table')`);
  await cdp.evaluate(`window.MicaCloud.flush().then(()=>location.reload())`);assert(await waitFor(cdp,`document.readyState==='complete'&&!!document.querySelector('.metrics-grid')`));
  await check('Modelo e atividades sobrevivem ao reload',`window.MicaData.load().records['fixture-0'].pipeline.stage==='oportunidades'&&window.MicaData.load().records['fixture-0'].history.some(event=>event.type==='reopen')`);
  assert.equal(exceptions.length,0,JSON.stringify(exceptions));passed++;
  console.log(JSON.stringify({ok:true,passed,exceptions}));
}catch(error){console.log(JSON.stringify({ok:false,passed,error:String(error.stack||error),exceptions}));process.exitCode=1;}
finally{await harness.close();}
