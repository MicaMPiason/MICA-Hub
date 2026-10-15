(function(){
  var preference='system';
  try{preference=localStorage.getItem('mica-theme')||'system';}catch(error){}
  if(['system','light','dark'].indexOf(preference)<0)preference='system';
  document.documentElement.dataset.theme=preference==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):preference;
  document.documentElement.dataset.themePreference=preference;
})();
