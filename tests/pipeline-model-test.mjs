import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const context=vm.createContext({window:{}});
vm.runInContext(readFileSync(new URL('../assets/js/pipeline.js',import.meta.url),'utf8'),context);
const model=context.window.MicaPipeline;
let passed=0;
function check(name,run){run();passed++;console.log('PASS '+name);}
const record={stage:'conversou',history:[{id:'old-event',type:'note',at:'2026-01-01T10:00:00Z',detail:'Preservar'}],attempts:1,negotiation:{commercialNotes:'Preservar'},nextAction:null};
const stamp=new Date(Date.now()-60000).toISOString();
const input={operationId:'operation-1',at:stamp,userId:'user-a',note:'Teste'};
for(const [legacy,destination,status] of [['a_prospectar','a_prospectar','Novo lead'],['tentando_contato','em_contato','Aguardando resposta'],['conversou','em_contato','Conversou'],['reuniao_agendada','oportunidades','Reunião agendada'],['proposta_enviada','propostas','Proposta enviada'],['negociacao','propostas','Negociando valores'],['fechado','fechado','Venda confirmada'],['perdido','perdido','Negócio perdido']]){
  check('Compatibilidade: '+legacy,()=>{const old={...record,stage:legacy},snapshot=JSON.stringify(old),mapped=model.normalize(old);assert.equal(mapped.stage,destination);assert.equal(mapped.substatus,status);assert.equal(mapped.legacyStage,legacy);assert.equal(JSON.stringify(old),snapshot);});
}
check('Normalização não inventa datas ou atividades',()=>{const mapped=model.normalize(record);assert(!mapped.date);assert.equal(record.history.length,1);});
const message=model.activity(record,{...input,type:'whatsapp',result:'WhatsApp enviado'});
check('WhatsApp mantém a etapa e o histórico',()=>{assert.equal(message.pipeline.stage,'em_contato');assert.equal(message.pipeline.substatus,'WhatsApp enviado');assert.equal(message.history.length,2);assert.equal(message.history[0].id,'old-event');assert.equal(message.history[1].userId,'user-a');assert.equal(record.history.length,1);});
check('Repetir a mesma operação não duplica atividade',()=>assert.equal(model.activity(message,{...input,type:'whatsapp'}).history.length,2));
const call=model.activity(message,{...input,operationId:'call-1',type:'call',result:'Não atendeu'});
check('Ligação é independente de mudança de etapa',()=>{assert.equal(call.pipeline.stage,'em_contato');assert.equal(call.attempts,2);assert.equal(call.pipeline.substatus,'Não atendeu');assert.equal(call.history.filter(event=>event.type==='stage').length,0);});
const meeting=model.move(call,{...input,operationId:'meeting-1',destination:'oportunidades',substatus:'Reunião agendada',activityType:'meeting',meetingPlace:'Online',nextAction:{type:'Reunião',date:'2030-01-01',time:'14:00'}});
check('Reunião grava etapa, atividade e próxima ação juntas',()=>{assert.equal(meeting.pipeline.stage,'oportunidades');assert.equal(meeting.nextAction.time,'14:00');assert.equal(meeting.history.filter(event=>event.meta?.operationId==='meeting-1').length,3);});
check('Repetir a movimentação não duplica histórico',()=>assert.equal(model.move(meeting,{...input,operationId:'meeting-1',destination:'oportunidades',substatus:'Reunião agendada',meetingPlace:'Online',nextAction:{type:'Reunião',date:'2030-01-01',time:'14:00'}}).history.length,meeting.history.length));
check('Reunião exige informações complementares',()=>assert.throws(()=>model.move(call,{...input,destination:'oportunidades',substatus:'Reunião agendada'})));
const closed=model.move(meeting,{...input,operationId:'close-1',destination:'fechado',substatus:'Venda confirmada',value:1500,service:'Site',closedDate:stamp.slice(0,10),recurring:50});
check('Fechamento permite salto e preserva dados anteriores',()=>{assert.equal(closed.pipeline.closure.result,'won');assert.equal(closed.pipeline.closure.recurring,50);assert.equal(closed.negotiation.commercialNotes,'Preservar');assert.equal(closed.nextAction,null);});
check('Venda exige serviço e valor positivos',()=>assert.throws(()=>model.move(record,{...input,destination:'fechado',substatus:'Venda confirmada',value:0})));
const reopened=model.move(closed,{...input,operationId:'reopen-1',destination:'em_contato',substatus:'Aguardando resposta'});
check('Reabertura preserva fechamento e identifica evento',()=>{assert.equal(reopened.pipeline.previousClosures[0].value,1500);assert.equal(reopened.history.at(-1).type,'reopen');assert.equal(reopened.pipeline.legacyStage,'conversou');});
const lost=model.move(record,{...input,operationId:'loss-1',destination:'perdido',substatus:'Negócio perdido',lossReason:'Escolheu concorrente',reopenAllowed:true});
check('Perdidos nunca são classificados como ganhos',()=>{assert.equal(lost.pipeline.closure.result,'lost');assert(model.finished(lost));assert(!model.queue(lost,99,'2026-10-16'));});
check('Movimentações para trás são permitidas',()=>assert.equal(model.move(meeting,{...input,operationId:'back-1',destination:'a_prospectar',substatus:'Aguardando abordagem'}).pipeline.stage,'a_prospectar'));
check('Próximas ações atrasadas têm precedência na fila',()=>{const queued={...record,nextAction:{date:'2026-10-15',time:'10:00'}};assert.equal(model.queue(queued,50,'2026-10-16').rank,0);});
check('A fila não é cópia de A prospectar',()=>assert.equal(model.queue({stage:'a_prospectar',history:[]},40,'2026-10-16'),null));
check('Etapa de proposta não inventa reunião histórica',()=>assert(!model.activityMatches({type:'stage',meta:{to:'propostas',substatus:'Negociando valores'}},'meetings')));
check('Um retorno gera IDs únicos',()=>{const activity=model.activity(record,{...input,type:'followup',nextAction:{type:'Ligar',date:'2030-01-01'}});assert.equal(new Set(activity.history.map(event=>event.id)).size,activity.history.length);});
console.log(`PASS: ${passed} regras e compatibilidade da pipeline.`);
