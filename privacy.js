(function(){
  const source=document.currentScript;
  const measurementId=source&&source.dataset.measurementId;
  const storageKey='prio_cookie_consent_v1';
  const maxChoiceAge=180*24*60*60*1000;
  let analyticsLoaded=false;

  function readChoice(){
    try{
      const saved=JSON.parse(localStorage.getItem(storageKey));
      if(!saved||!saved.choice||!saved.savedAt||Date.now()-saved.savedAt>maxChoiceAge){
        localStorage.removeItem(storageKey);
        return null;
      }
      return saved.choice;
    }catch(error){return null}
  }

  function saveChoice(choice){
    try{localStorage.setItem(storageKey,JSON.stringify({choice:choice,savedAt:Date.now()}))}catch(error){}
  }

  function loadAnalytics(){
    if(!measurementId||analyticsLoaded)return;
    analyticsLoaded=true;
    window.dataLayer=window.dataLayer||[];
    window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};
    window.gtag('consent','default',{
      analytics_storage:'granted',
      ad_storage:'denied',
      ad_user_data:'denied',
      ad_personalization:'denied'
    });
    window.gtag('js',new Date());
    window.gtag('config',measurementId,{anonymize_ip:true,cookie_expires:34128000});
    const tag=document.createElement('script');
    tag.async=true;
    tag.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(measurementId);
    document.head.appendChild(tag);
  }

  function deleteAnalyticsCookies(){
    document.cookie.split(';').forEach(function(cookie){
      const name=cookie.split('=')[0].trim();
      if(name==='_ga'||name.indexOf('_ga_')===0){
        document.cookie=name+'=; Max-Age=0; path=/; SameSite=Lax';
        document.cookie=name+'=; Max-Age=0; path=/; domain='+location.hostname+'; SameSite=Lax';
        document.cookie=name+'=; Max-Age=0; path=/; domain=.'+location.hostname+'; SameSite=Lax';
      }
    });
  }

  function denyAnalytics(){
    if(window.gtag){
      window.gtag('consent','update',{
        analytics_storage:'denied',
        ad_storage:'denied',
        ad_user_data:'denied',
        ad_personalization:'denied'
      });
    }
    deleteAnalyticsCookies();
  }

  const initialChoice=readChoice();
  if(initialChoice==='accepted')loadAnalytics();

  function initControls(){
    const banner=document.querySelector('[data-cookie-banner]');
    if(!banner)return;
    const accept=banner.querySelector('[data-cookie-accept]');
    const decline=banner.querySelector('[data-cookie-decline]');
    const settings=document.querySelectorAll('[data-cookie-settings]');

    function show(){
      banner.hidden=false;
      window.requestAnimationFrame(function(){banner.classList.add('is-visible')});
      if(accept)accept.focus();
    }

    function hide(){
      banner.classList.remove('is-visible');
      window.setTimeout(function(){banner.hidden=true},180);
    }

    if(accept)accept.addEventListener('click',function(){
      saveChoice('accepted');
      loadAnalytics();
      hide();
    });

    if(decline)decline.addEventListener('click',function(){
      saveChoice('declined');
      denyAnalytics();
      hide();
    });

    settings.forEach(function(button){button.addEventListener('click',show)});
    if(!initialChoice)show();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initControls);
  else initControls();
})();
