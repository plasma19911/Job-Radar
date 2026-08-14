let deferredInstallPrompt=null;
const btn=document.getElementById('installAppBtn');
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);

function showButton(){if(btn&&!isStandalone())btn.hidden=false;}
function hideButton(){if(btn)btn.hidden=true;}

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  deferredInstallPrompt=e;
  showButton();
});

window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  hideButton();
});

if(btn){
  btn.addEventListener('click',async()=>{
    if(isStandalone()){hideButton();return;}
    if(deferredInstallPrompt){
      deferredInstallPrompt.prompt();
      try{await deferredInstallPrompt.userChoice;}catch{}
      deferredInstallPrompt=null;
      return;
    }
    if(isIOS()){
      alert('Auf iPhone/iPad: unten auf „Teilen“ tippen und dann „Zum Home-Bildschirm“ wählen. Danach startet Job Radar wie eine App mit eigenem Icon.');
      return;
    }
    alert('Im Browser-Menü „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen.');
  });
}

if(isIOS()&&!isStandalone())showButton();
