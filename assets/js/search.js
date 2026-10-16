(function(global){
  "use strict";

  function createNexoSearch(){
    function normalizeText(value){
      return String(value==null?"":value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
    }
    function normalizeNumber(value){return String(value==null?"":value).replace(/\D/g,"");}
    function debounce(fn,delay){var timer;return function(){var context=this,args=arguments;clearTimeout(timer);timer=setTimeout(function(){fn.apply(context,args);},delay==null?250:delay);};}
    function values(value){return Array.isArray(value)?value.filter(Boolean):value?[value]:[];}
    function distance(a,b,limit){
      if(a===b)return 0;if(Math.abs(a.length-b.length)>limit)return limit+1;
      var previous=Array.from({length:b.length+1},function(_,i){return i;});
      for(var i=1;i<=a.length;i++){
        var current=[i],rowMin=i;
        for(var j=1;j<=b.length;j++){var cost=a[i-1]===b[j-1]?0:1;current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+cost);rowMin=Math.min(rowMin,current[j]);}
        if(rowMin>limit)return limit+1;previous=current;
      }
      return previous[b.length];
    }
    function fuzzyLimit(token){return token.length>=9?2:token.length>=5?1:0;}
    function prepareField(field){
      var text=values(field.value).join(" "),normalized=normalizeText(text);
      return {name:field.name||"other",weight:Number(field.weight)||1,text:normalized,words:normalized.split(/[^a-z0-9]+/).filter(Boolean),numbers:normalizeNumber(text)};
    }
    function exactScore(field,token){
      if(!field.text)return 0;
      var base=field.weight*100;
      if(field.text===token)return base+90;
      if(token.length<=2){if(field.words.some(function(word){return word===token;}))return base+60;return token.length===2&&field.words.some(function(word){return word.indexOf(token)===0;})?base+40:0;}
      if(field.text.indexOf(token)===0)return base+70;
      if(field.words.some(function(word){return word===token;}))return base+60;
      if(field.words.some(function(word){return word.indexOf(token)===0;}))return base+45;
      if(field.text.indexOf(token)>=0)return base+25;
      return 0;
    }
    function fuzzyScore(field,token){
      var limit=fuzzyLimit(token),best=limit+1;if(!limit)return 0;
      field.words.forEach(function(word){if(Math.abs(word.length-token.length)<=limit)best=Math.min(best,distance(token,word,limit));});
      return best<=limit?field.weight*22+(limit-best+1)*8:0;
    }
    function tokenScore(document,token){
      var numeric=/^\d+$/.test(token)&&token.length>=3,best=0;
      document.fields.forEach(function(field){
        if(!numeric&&token.length<=2&&!["name","company","contact","tags","segment","city"].includes(field.name))return;
        var score=numeric?(field.numbers.indexOf(token)>=0?field.weight*100+55:0):exactScore(field,token);
        if(!score&&!numeric)score=fuzzyScore(field,token);
        best=Math.max(best,score);
      });
      return best;
    }
    function create(){
      var documents=[];
      return {
        build:function(items,mapper){
          documents=(items||[]).map(function(item){var raw=mapper(item)||{},fields=(raw.fields||[]).map(prepareField);return {id:String(raw.id||item.id),item:item,fields:fields};});
          return documents.length;
        },
        search:function(query){
          var normalized=normalizeText(query),queryDigits=normalizeNumber(query),tokens=queryDigits.length>=5&&!/[a-z]/.test(normalized)?[queryDigits]:normalized.split(" ").map(function(token){var numeric=normalizeNumber(token);return numeric.length>=3&&!/[a-z]/.test(token)?numeric:token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g,"");}).filter(Boolean);if(!tokens.length)return documents.map(function(document){return {id:document.id,item:document.item,score:0};});
          return documents.map(function(document){var score=0,matched=true;tokens.forEach(function(token){var value=tokenScore(document,token);if(!value)matched=false;else score+=value;});if(matched){var name=document.fields.find(function(field){return field.name==="name";}),company=document.fields.find(function(field){return field.name==="company";});[name,company].filter(Boolean).forEach(function(field){if(field.text===normalized)score+=260*field.weight;else if(field.text.indexOf(normalized)===0)score+=140*field.weight;});}return matched?{id:document.id,item:document.item,score:score}:null;}).filter(Boolean).sort(function(a,b){return b.score-a.score||a.id.localeCompare(b.id);});
        },
        size:function(){return documents.length;}
      };
    }
    return {create:create,normalizeText:normalizeText,normalizeNumber:normalizeNumber,debounce:debounce};
  }

  global.NexoSearch=createNexoSearch();
})(window);
