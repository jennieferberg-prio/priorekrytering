(function(){
  "use strict";

  const config=window.PRIO_STATS_CONFIG||{};
  const params=new URLSearchParams(window.location.search);
  const localHost=["localhost","127.0.0.1"].includes(window.location.hostname)||window.location.protocol==="file:";
  const mockMode=params.get("mock")==="1"||(localHost&&params.get("live")!=="1");
  const state={days:28,token:null};
  const numberFormat=new Intl.NumberFormat("sv-SE");
  const decimalFormat=new Intl.NumberFormat("sv-SE",{maximumFractionDigits:1});
  const dateFormat=new Intl.DateTimeFormat("sv-SE",{day:"numeric",month:"short"});
  const deviceColors=["#7c3f72","#c76f87","#5574a8","#6c8f7b"];
  const deviceNames={desktop:"Dator",mobile:"Mobil",tablet:"Surfplatta",other:"Övrigt"};

  const elements={
    auth:document.getElementById("auth-panel"),dashboard:document.getElementById("dashboard"),
    login:document.getElementById("login-button"),logout:document.getElementById("logout-button"),
    demo:document.getElementById("demo-button"),demoBadge:document.getElementById("demo-badge"),
    authStatus:document.getElementById("auth-status"),loading:document.getElementById("loading-bar"),
    error:document.getElementById("error-banner"),lastUpdated:document.getElementById("last-updated")
  };

  function isoDate(date){return date.toISOString().slice(0,10)}
  function dateRange(){
    const end=new Date();
    const start=new Date(end);
    start.setUTCDate(start.getUTCDate()-state.days+1);
    return {start:isoDate(start),end:isoDate(end)};
  }
  function seconds(value){
    const total=Math.max(0,Math.round(Number(value)||0));
    const minutes=Math.floor(total/60);
    return minutes?`${minutes} min ${String(total%60).padStart(2,"0")} s`:`${total} s`;
  }
  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char]);
  }
  function showDashboard(){
    elements.auth.hidden=true;
    elements.dashboard.hidden=false;
    elements.logout.hidden=mockMode;
    elements.demoBadge.hidden=!mockMode;
  }
  function setLoading(loading){elements.loading.hidden=!loading}
  function showError(message){elements.error.textContent=message;elements.error.hidden=!message}

  function loadGoogleIdentity(){
    return new Promise((resolve,reject)=>{
      if(window.google?.accounts?.oauth2)return resolve();
      const script=document.createElement("script");
      script.src="https://accounts.google.com/gsi/client";
      script.async=true;
      script.onload=resolve;
      script.onerror=()=>reject(new Error("Google-inloggningen kunde inte laddas."));
      document.head.appendChild(script);
    });
  }

  async function login(){
    if(!config.googleClientId){
      elements.authStatus.textContent="Google-kopplingen är inte konfigurerad ännu. Kör lokalt för att använda testdata.";
      return;
    }
    elements.authStatus.textContent="Öppnar Google-inloggningen…";
    try{
      await loadGoogleIdentity();
      const client=google.accounts.oauth2.initTokenClient({
        client_id:config.googleClientId,
        scope:"https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly",
        callback:async response=>{
          if(response.error){elements.authStatus.textContent="Inloggningen avbröts eller misslyckades.";return}
          state.token=response.access_token;
          elements.authStatus.textContent="";
          showDashboard();
          await loadData();
        },
        error_callback:()=>{elements.authStatus.textContent="Google-inloggningen kunde inte slutföras."}
      });
      client.requestAccessToken({prompt:"consent"});
    }catch(error){elements.authStatus.textContent=error.message}
  }

  function logout(){
    if(state.token&&window.google?.accounts?.oauth2){google.accounts.oauth2.revoke(state.token,()=>{})}
    state.token=null;
    elements.dashboard.hidden=true;
    elements.auth.hidden=false;
    elements.logout.hidden=true;
    elements.authStatus.textContent="Du är utloggad.";
  }

  async function apiPost(url,body){
    const response=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${state.token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(response.status===401){logout();throw new Error("Google-sessionen har gått ut. Logga in igen.")}
    if(!response.ok){
      let detail="";
      try{detail=(await response.json()).error?.message||""}catch(_error){}
      throw new Error(detail||`Google API svarade med ${response.status}.`);
    }
    return response.json();
  }

  function gaReport(body){
    return apiPost(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(config.ga4PropertyId)}:runReport`,body);
  }
  function gaBody(range,dimensions,metrics,limit=100){
    return {dateRanges:[{startDate:range.start,endDate:range.end}],dimensions:dimensions.map(name=>({name})),metrics:metrics.map(name=>({name})),limit:String(limit)};
  }
  function parseGaRows(report){
    const dimensions=(report.dimensionHeaders||[]).map(item=>item.name);
    const metrics=(report.metricHeaders||[]).map(item=>item.name);
    return (report.rows||[]).map(row=>{
      const result={};
      dimensions.forEach((name,index)=>{result[name]=row.dimensionValues[index]?.value||""});
      metrics.forEach((name,index)=>{result[name]=Number(row.metricValues[index]?.value||0)});
      return result;
    });
  }

  async function fetchLiveData(){
    const range=dateRange();
    const baseMetrics=["activeUsers","sessions","screenPageViews","userEngagementDuration"];
    const requests=[
      gaReport(gaBody(range,[],baseMetrics,1)),
      gaReport(gaBody(range,["date"],["activeUsers","sessions"],state.days)),
      gaReport({...gaBody(range,["firstUserSourceMedium"],["totalUsers"],12),orderBys:[{metric:{metricName:"totalUsers"},desc:true}]}),
      gaReport({...gaBody(range,["landingPagePlusQueryString"],baseMetrics,20),orderBys:[{metric:{metricName:"sessions"},desc:true}]}),
      gaReport({...gaBody(range,["pagePathPlusQueryString"],["screenPageViews","activeUsers","userEngagementDuration"],20),orderBys:[{metric:{metricName:"screenPageViews"},desc:true}]}),
      gaReport({...gaBody(range,["country"],["activeUsers"],8),orderBys:[{metric:{metricName:"activeUsers"},desc:true}]}),
      gaReport({...gaBody(range,["deviceCategory"],["activeUsers"],8),orderBys:[{metric:{metricName:"activeUsers"},desc:true}]})
    ];
    const [summaryReport,trendReport,sourceReport,landingReport,pageReport,countryReport,deviceReport]=await Promise.all(requests);
    const summary=parseGaRows(summaryReport)[0]||{};
    let searches=[];
    let searchError="";
    try{
      const searchResponse=await apiPost(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.searchConsoleSite)}/searchAnalytics/query`,{
        startDate:range.start,endDate:range.end,dimensions:["query"],type:"web",rowLimit:25,dataState:"all"
      });
      searches=(searchResponse.rows||[]).map(row=>({query:row.keys?.[0]||"",clicks:row.clicks||0,impressions:row.impressions||0,ctr:row.ctr||0,position:row.position||0}));
    }catch(error){searchError=error.message}
    return {
      range,summary,trend:parseGaRows(trendReport),sources:parseGaRows(sourceReport),
      landings:parseGaRows(landingReport),pages:parseGaRows(pageReport),countries:parseGaRows(countryReport),devices:parseGaRows(deviceReport),
      searches,searchError
    };
  }

  function seededValue(index,base,spread){
    const wave=Math.sin(index*1.37)*.55+Math.cos(index*.58)*.45;
    return Math.max(1,Math.round(base+wave*spread+(index%7===1?spread*.7:0)));
  }
  function mockData(){
    const range=dateRange();
    const multiplier=Math.max(.4,state.days/28);
    const trend=[];
    const start=new Date(`${range.start}T00:00:00Z`);
    for(let index=0;index<state.days;index++){
      const date=new Date(start);date.setUTCDate(start.getUTCDate()+index);
      const users=seededValue(index,8,4);
      trend.push({date:isoDate(date).replaceAll("-",""),activeUsers:users,sessions:users+seededValue(index+3,3,2)});
    }
    const sessions=trend.reduce((sum,row)=>sum+row.sessions,0);
    const users=Math.round(sessions*.71);
    return {
      range,
      summary:{activeUsers:users,sessions,screenPageViews:Math.round(sessions*1.74),userEngagementDuration:sessions*74},
      trend,
      sources:[
        ["google / organic",Math.round(users*.48)],["(direct) / (none)",Math.round(users*.28)],
        ["linkedin.com / referral",Math.round(users*.13)],["bing / organic",Math.round(users*.06)],
        ["instagram.com / referral",Math.round(users*.03)]
      ].map(([firstUserSourceMedium,totalUsers])=>({firstUserSourceMedium,totalUsers})),
      landings:[
        ["/",.52,1.9,88],["/lediga-jobb.html",.19,2.3,102],["/sa-fungerar-prio.html",.14,1.7,76],
        ["/kontakt.html",.1,1.6,64],["/om.html",.05,1.5,58]
      ].map(([landingPagePlusQueryString,share,pages,time])=>{const visits=Math.max(1,Math.round(sessions*share));return {landingPagePlusQueryString,sessions:visits,activeUsers:Math.round(visits*.78),screenPageViews:Math.round(visits*pages),userEngagementDuration:visits*time}}),
      pages:[
        ["/",315,129,9400],["/lediga-jobb.html",140,48,5200],["/sa-fungerar-prio.html",77,35,3800],
        ["/kontakt.html",51,25,2100],["/om.html",24,12,1300]
      ].map(([pagePathPlusQueryString,views,activeUsers,userEngagementDuration])=>({pagePathPlusQueryString,screenPageViews:Math.round(views*multiplier),activeUsers:Math.round(activeUsers*multiplier),userEngagementDuration:Math.round(userEngagementDuration*multiplier)})),
      countries:[["Sweden",.82],["Norway",.07],["Denmark",.05],["Germany",.03],["United Kingdom",.02]].map(([country,share])=>({country,activeUsers:Math.max(1,Math.round(users*share))})),
      devices:[["mobile",.57],["desktop",.39],["tablet",.04]].map(([deviceCategory,share])=>({deviceCategory,activeUsers:Math.max(1,Math.round(users*share))})),
      searches:[
        ["prio rekrytering",18,94,.191,1.4],["rekryteringsföretag göteborg",9,138,.065,7.2],
        ["headhunting göteborg",7,112,.063,6.8],["rekrytering bygg göteborg",5,83,.06,8.1],
        ["prio headhunting",4,21,.19,2.3],["rekryterare inom bygg",3,67,.045,9.4]
      ].map(([query,clicks,impressions,ctr,position])=>({query,clicks:Math.round(clicks*multiplier),impressions:Math.round(impressions*multiplier),ctr,position})),
      searchError:""
    };
  }

  function renderMetrics(summary){
    document.getElementById("metric-users").textContent=numberFormat.format(summary.activeUsers||0);
    document.getElementById("metric-sessions").textContent=numberFormat.format(summary.sessions||0);
    document.getElementById("metric-views").textContent=numberFormat.format(summary.screenPageViews||0);
    document.getElementById("metric-engagement").textContent=seconds((summary.userEngagementDuration||0)/Math.max(1,summary.sessions||0));
  }
  function renderTrend(rows){
    const container=document.getElementById("trend-chart");
    if(!rows.length){container.innerHTML='<p class="empty-row">Ingen data för perioden.</p>';return}
    const width=760,height=240,padding={top:12,right:12,bottom:28,left:35};
    const max=Math.max(...rows.flatMap(row=>[row.activeUsers,row.sessions]),1);
    const x=index=>padding.left+(index/Math.max(1,rows.length-1))*(width-padding.left-padding.right);
    const y=value=>padding.top+(1-value/max)*(height-padding.top-padding.bottom);
    const points=key=>rows.map((row,index)=>`${x(index).toFixed(1)},${y(row[key]).toFixed(1)}`).join(" ");
    const area=`${x(0)},${height-padding.bottom} ${points("activeUsers")} ${x(rows.length-1)},${height-padding.bottom}`;
    const labels=[0,Math.floor((rows.length-1)/2),rows.length-1].filter((value,index,array)=>array.indexOf(value)===index);
    const grid=[0,.25,.5,.75,1].map(ratio=>`<line class="chart-grid" x1="${padding.left}" y1="${y(max*ratio)}" x2="${width-padding.right}" y2="${y(max*ratio)}"/><text class="chart-label" x="0" y="${y(max*ratio)+4}">${Math.round(max*ratio)}</text>`).join("");
    const dates=labels.map(index=>{const value=rows[index].date;const date=new Date(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T00:00:00Z`);return `<text class="chart-label" text-anchor="${index===0?"start":index===rows.length-1?"end":"middle"}" x="${x(index)}" y="${height-5}">${escapeHtml(dateFormat.format(date))}</text>`}).join("");
    container.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img"><defs><linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c3f72" stop-opacity=".19"/><stop offset="1" stop-color="#7c3f72" stop-opacity="0"/></linearGradient></defs>${grid}<polygon class="chart-area" points="${area}"/><polyline class="chart-sessions" points="${points("sessions")}"/><polyline class="chart-users" points="${points("activeUsers")}"/>${dates}</svg>`;
  }
  function renderBars(id,rows,labelKey,valueKey,compact=false){
    const container=document.getElementById(id);
    const max=Math.max(...rows.map(row=>row[valueKey]),1);
    container.innerHTML=rows.length?rows.slice(0,compact?5:8).map(row=>`<div class="bar-row"><span title="${escapeHtml(row[labelKey])}">${escapeHtml(row[labelKey])}</span><div class="bar-track"><span style="width:${Math.max(2,row[valueKey]/max*100).toFixed(1)}%"></span></div><strong>${numberFormat.format(row[valueKey])}</strong></div>`).join(""):'<p class="empty-row">Ingen data för perioden.</p>';
  }
  function renderDevices(rows){
    const total=rows.reduce((sum,row)=>sum+row.activeUsers,0)||1;
    let cursor=0;
    const stops=rows.map((row,index)=>{const start=cursor;cursor+=row.activeUsers/total*100;return `${deviceColors[index%deviceColors.length]} ${start.toFixed(1)}% ${cursor.toFixed(1)}%`});
    document.getElementById("device-donut").style.background=`conic-gradient(${stops.join(",")})`;
    document.getElementById("device-total").textContent=numberFormat.format(total);
    document.getElementById("device-legend").innerHTML=rows.map((row,index)=>`<div class="device-item"><i style="background:${deviceColors[index%deviceColors.length]}"></i><span>${escapeHtml(deviceNames[row.deviceCategory]||row.deviceCategory)}</span><strong>${decimalFormat.format(row.activeUsers/total*100)}%</strong></div>`).join("");
  }
  function renderLandings(rows){
    const body=document.getElementById("landing-table");
    body.innerHTML=rows.length?rows.slice(0,12).map(row=>`<tr><td title="${escapeHtml(row.landingPagePlusQueryString)}">${escapeHtml(row.landingPagePlusQueryString||"(inte angiven)")}</td><td>${numberFormat.format(row.sessions)}</td><td>${numberFormat.format(row.activeUsers)}</td><td>${numberFormat.format(row.screenPageViews)}</td><td>${seconds(row.userEngagementDuration/Math.max(1,row.sessions))}</td></tr>`).join(""):'<tr class="empty-row"><td colspan="5">Ingen data för perioden.</td></tr>';
  }
  function renderPages(rows){
    const body=document.getElementById("page-table");
    body.innerHTML=rows.length?rows.slice(0,12).map(row=>`<tr><td title="${escapeHtml(row.pagePathPlusQueryString)}">${escapeHtml(row.pagePathPlusQueryString||"(inte angiven)")}</td><td>${numberFormat.format(row.screenPageViews)}</td><td>${numberFormat.format(row.activeUsers)}</td><td>${seconds(row.userEngagementDuration/Math.max(1,row.activeUsers))} / besökare</td></tr>`).join(""):'<tr class="empty-row"><td colspan="4">Ingen data för perioden.</td></tr>';
  }
  function renderSearches(rows,error){
    const body=document.getElementById("search-table");
    const status=document.getElementById("search-status");
    status.textContent=error?"Search Console kunde inte hämtas":"Organiska Google-sökningar";
    body.innerHTML=rows.length?rows.slice(0,20).map(row=>`<tr><td>${escapeHtml(row.query||"(dold sökfråga)")}</td><td>${numberFormat.format(row.clicks)}</td><td>${numberFormat.format(row.impressions)}</td><td>${decimalFormat.format(row.ctr*100)}%</td><td>${decimalFormat.format(row.position)}</td></tr>`).join(""):`<tr class="empty-row"><td colspan="5">${escapeHtml(error||"Search Console har ännu ingen data för perioden.")}</td></tr>`;
  }
  function render(data){
    renderMetrics(data.summary);renderTrend(data.trend);
    renderBars("source-list",data.sources,"firstUserSourceMedium","totalUsers");
    renderBars("country-list",data.countries,"country","activeUsers",true);
    renderDevices(data.devices);renderPages(data.pages);renderLandings(data.landings);renderSearches(data.searches,data.searchError);
    const start=new Date(`${data.range.start}T00:00:00Z`),end=new Date(`${data.range.end}T00:00:00Z`);
    elements.lastUpdated.textContent=`${dateFormat.format(start)}–${dateFormat.format(end)} · Uppdaterad ${new Intl.DateTimeFormat("sv-SE",{hour:"2-digit",minute:"2-digit"}).format(new Date())}`;
  }

  async function loadData(){
    setLoading(true);showError("");
    try{render(mockMode?mockData():await fetchLiveData())}
    catch(error){showError(error.message||"Statistiken kunde inte hämtas.")}
    finally{setLoading(false)}
  }

  elements.login.addEventListener("click",login);
  elements.logout.addEventListener("click",logout);
  elements.demo.addEventListener("click",()=>{showDashboard();loadData()});
  document.querySelectorAll("[data-days]").forEach(button=>button.addEventListener("click",()=>{
    state.days=Number(button.dataset.days);
    document.querySelectorAll("[data-days]").forEach(item=>item.classList.toggle("active",item===button));
    loadData();
  }));

  if(mockMode){showDashboard();loadData()}
  else if(!config.googleClientId){elements.authStatus.textContent="Google OAuth behöver konfigureras innan sidan kan hämta riktig data."}
})();
