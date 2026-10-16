(function(global){
  "use strict";
  var stages=[
    {id:"a_prospectar",name:"A prospectar",color:"#8b9189",statuses:["Novo lead","Priorizado","Aguardando abordagem"]},
    {id:"em_contato",name:"Em contato",color:"#ffbd59",statuses:["WhatsApp enviado","Ligação realizada","Não atendeu","Conversou","Aguardando resposta","Retorno agendado","Sem resposta"]},
    {id:"oportunidades",name:"Oportunidades",color:"#7eb7ff",statuses:["Demonstrou interesse","Reunião agendada","Reunião realizada","Esboço em preparação","Esboço apresentado","Aguardando decisão"]},
    {id:"propostas",name:"Propostas",color:"#b7a0ff",statuses:["Proposta enviada","Aguardando resposta","Solicitou alterações","Negociando valores","Aguardando aprovação"]},
    {id:"fechado",name:"Fechados",statuses:["Venda confirmada"]},
    {id:"perdido",name:"Perdidos",statuses:["Negócio perdido"]}
  ];
  var legacy={a_prospectar:["a_prospectar","Novo lead"],tentando_contato:["em_contato","Aguardando resposta"],conversou:["em_contato","Conversou"],reuniao_agendada:["oportunidades","Reunião agendada"],proposta_enviada:["propostas","Proposta enviada"],negociacao:["propostas","Negociando valores"],fechado:["fechado","Venda confirmada"],perdido:["perdido","Negócio perdido"]};
  var losses=["Sem interesse","Preço acima do orçamento","Escolheu concorrente","Não respondeu","Não precisa do serviço","Outro motivo"];
  function copy(value){return JSON.parse(JSON.stringify(value));}
  function localDay(value){var date=new Date(value);return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");}
  function stage(id){return stages.find(function(item){return item.id===id;});}
  function normalize(record){
    var previous=record.pipeline;
    if(previous&&stage(previous.stage))return Object.assign({},previous,{substatus:stage(previous.stage).statuses.includes(previous.substatus)?previous.substatus:stage(previous.stage).statuses[0]});
    var mapped=legacy[record.stage]||legacy.a_prospectar,status=mapped[1],history=record.history||[],last=history.slice().reverse().find(function(event){return ["call","whatsapp"].includes(event.type);});
    if(mapped[0]==="em_contato"&&record.stage!=="conversou"&&last){if(last.type==="whatsapp")status="WhatsApp enviado";else if(last.meta&&last.meta.answered===false)status="Não atendeu";}
    return {version:1,stage:mapped[0],substatus:status,legacyStage:record.stage||"a_prospectar",closure:null};
  }
  function compatibility(pipeline){
    if(pipeline.stage==="em_contato")return pipeline.substatus==="Conversou"?"conversou":"tentando_contato";
    if(pipeline.stage==="oportunidades")return pipeline.substatus.indexOf("Reunião")===0?"reuniao_agendada":"conversou";
    if(pipeline.stage==="propostas")return pipeline.substatus==="Negociando valores"?"negociacao":"proposta_enviada";
    return pipeline.stage;
  }
  function resolve(destination){return stage(destination)?{stage:destination,substatus:stage(destination).statuses[0]}:legacy[destination]?{stage:legacy[destination][0],substatus:legacy[destination][1]}:null;}
  function finished(record){return ["fechado","perdido"].includes(normalize(record).stage);}
  function makeEvent(input,type,label,meta){return {id:input.operationId+"_"+type,type:type,label:label,detail:input.note||"",at:input.at,userId:input.userId||"",result:input.result||label,meta:Object.assign({operationId:input.operationId},meta||{})};}
  function validate(input){if(!input.operationId||!input.at||isNaN(Date.parse(input.at)))throw new Error("Informe uma data e horário válidos.");if(new Date(input.at)>new Date(Date.now()+60000))throw new Error("A interação não pode estar no futuro.");if(input.nextAction&&!/^\d{4}-\d{2}-\d{2}$/.test(input.nextAction.date||""))throw new Error("Informe a data da próxima ação.");}
  function addActivity(record,input){
    validate(input);var out=copy(record),pipeline=normalize(out);out.pipeline=pipeline;out.history=out.history||[];
    if(out.history.some(function(event){return event.meta&&event.meta.operationId===input.operationId;}))return out;
    var type=input.type||"note",event=makeEvent(input,type,input.label||input.result||"Observação",{answered:!!input.answered});
    out.history.push(event);out.updatedAt=input.at;
    if(["call","whatsapp","conversation"].includes(type)){out.lastContact=localDay(input.at);if(type==="call")out.attempts=(Number(out.attempts)||0)+1;}
    if(pipeline.stage==="em_contato"){
      var status=input.answered?"Conversou":type==="whatsapp"?"WhatsApp enviado":type==="call"?(input.result==="Não atendeu"?"Não atendeu":"Ligação realizada"):input.nextAction?"Retorno agendado":pipeline.substatus;
      pipeline.substatus=status;
    }
    if(input.nextAction){out.nextAction=copy(input.nextAction);if(type!=="followup")out.history.push(makeEvent(input,"followup","Próxima ação agendada",{nextAction:copy(input.nextAction)}));else event.meta.nextAction=copy(input.nextAction);}
    out.stage=compatibility(pipeline);return out;
  }
  function move(record,input){
    validate(input);var target=stage(input.destination);if(!target)throw new Error("Etapa inválida.");
    if(!target.statuses.includes(input.substatus))throw new Error("Escolha um resultado compatível com a etapa.");
    if(input.destination==="fechado"&&(!(Number(input.value)>0)||!String(input.service||"").trim()||!input.closedDate))throw new Error("Informe serviço, valor e data do fechamento.");
    if(Number(input.recurring)<0)throw new Error("A receita recorrente não pode ser negativa.");
    if(input.destination==="perdido"&&!String(input.lossReason||"").trim())throw new Error("Informe o motivo da perda.");
    if(input.substatus==="Reunião agendada"&&(!input.nextAction||!input.nextAction.time||!input.meetingPlace))throw new Error("Informe data, horário e local da reunião.");
    if(input.destination==="fechado"&&(!/^\d{4}-\d{2}-\d{2}$/.test(input.closedDate)||input.closedDate>localDay(Date.now())))throw new Error("Informe uma data de fechamento válida, não futura.");
    var out=copy(record),before=normalize(out);out.history=out.history||[];
    if(out.history.some(function(event){return event.meta&&event.meta.operationId===input.operationId;}))return out;
    var pipeline=Object.assign({},before,{stage:target.id,substatus:input.substatus});
    out.pipeline=pipeline;out.negotiation=out.negotiation||{};
    if(before.closure&&before.stage!==target.id)pipeline.previousClosures=(pipeline.previousClosures||[]).concat([copy(before.closure)]);
    if(input.destination==="fechado"){
      pipeline.closure={result:"won",service:input.service,value:Number(input.value),recurring:Number(input.recurring)||0,date:input.closedDate,note:input.note||""};
      out.negotiation.closedValue=Number(input.value);out.nextAction=null;
    }else if(input.destination==="perdido"){
      pipeline.closure={result:"lost",reason:input.lossReason,reopenAllowed:!!input.reopenAllowed,date:localDay(input.at),note:input.note||""};
      out.negotiation.lossReason=input.lossReason;out.negotiation.lossNote=input.note||"";out.nextAction=null;
    }else pipeline.closure=null;
    if(input.proposalValue!==""&&input.proposalValue!=null)out.negotiation.proposedValue=Number(input.proposalValue)||0;
    if(input.sentDate)out.negotiation.sentDate=input.sentDate;
    if(input.sketchStatus)out.negotiation.sketch={status:input.sketchStatus,dueDate:input.sketchDue||""};
    if(input.meetingPlace)out.negotiation.meetingPlace=input.meetingPlace;
    if(input.nextAction&&!finished(out))out.nextAction=copy(input.nextAction);
    var eventType=finished(record)&&!finished(out)?"reopen":"stage";
    if(before.stage!==pipeline.stage||before.substatus!==pipeline.substatus)out.history.push(makeEvent(input,eventType,eventType==="reopen"?"Negócio reaberto":"Etapa alterada",{from:before.stage,to:pipeline.stage,fromSubstatus:before.substatus,substatus:pipeline.substatus}));
    if(input.activityType)out.history.push(makeEvent(input,input.activityType,input.substatus,{answered:input.substatus==="Conversou"}));
    if(input.destination==="fechado")out.history.push(makeEvent(input,"close","Venda confirmada",{value:Number(input.value),service:input.service}));
    if(input.destination==="perdido")out.history.push(makeEvent(input,"loss","Negócio perdido",{reason:input.lossReason}));
    if(input.nextAction&&!finished(out))out.history.push(makeEvent(input,"followup","Próxima ação agendada",{nextAction:copy(input.nextAction)}));
    if(["call","whatsapp","conversation"].includes(input.activityType)){out.lastContact=localDay(input.at);if(input.activityType==="call")out.attempts=(Number(out.attempts)||0)+1;}
    out.stage=compatibility(pipeline);out.updatedAt=input.at;return out;
  }
  function activityMatches(event,kind){
    if(kind==="contacts")return ["call","whatsapp","conversation"].includes(event.type)&&!(event.meta&&event.meta.launchedOnly);
    if(kind==="meetings")return event.type==="meeting"||event.type==="stage"&&event.meta&&(event.meta.to==="reuniao_agendada"||event.meta.substatus==="Reunião agendada");
    if(kind==="proposals")return event.type==="proposal"||event.type==="stage"&&event.meta&&(event.meta.to==="proposta_enviada"||event.meta.substatus==="Proposta enviada");
    if(kind==="conversations")return event.type==="conversation"||event.type==="call"&&event.meta&&event.meta.answered;
    return event.type==="close"||event.type==="stage"&&event.meta&&event.meta.to==="fechado";
  }
  function queue(record,score,today){
    if(finished(record))return null;var next=record.nextAction,pipeline=normalize(record);
    if(next&&next.date<today)return {rank:0,label:"Ação atrasada",order:next.date+(next.time||"")};
    if(next&&next.date===today)return {rank:next.time?1:2,label:next.type||"Retorno hoje",order:next.date+(next.time||"23:59")};
    if(next&&next.type==="Reunião"&&next.date<=new Date(Date.parse(today)+86400000).toISOString().slice(0,10))return {rank:3,label:"Reunião próxima",order:next.date+(next.time||"")};
    if(!next&&score>=70)return {rank:4,label:"Prioritário sem próxima ação",order:""};
    if(!next&&["oportunidades","propostas"].includes(pipeline.stage))return {rank:5,label:"Oportunidade pendente",order:""};
    return null;
  }
  global.MicaPipeline={stages:stages,operational:stages.slice(0,4),losses:losses,stage:stage,normalize:normalize,resolve:resolve,compatibility:compatibility,finished:finished,activity:addActivity,move:move,activityMatches:activityMatches,queue:queue};
})(window);
