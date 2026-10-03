(function(global){
  "use strict";

  function createNexoStorage(){
    return {
      get:function(key,fallback){
        try{
          var raw=localStorage.getItem(key);
          if(raw===null)return fallback;
          try{return JSON.parse(raw);}catch(e){return raw;}
        }catch(e){return fallback;}
      },
      set:function(key,value){
        try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(e){return false;}
      },
      remove:function(key){
        try{localStorage.removeItem(key);return true;}catch(e){return false;}
      }
    };
  }

  global.createNexoStorage=createNexoStorage;
  global.NexoStorage=createNexoStorage();
})(window);
