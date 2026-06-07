const SEGMENTS=60;let countdown=60,refreshTimer,currentRange='24h',rawData=[];const browserPings={};
function rangeMs(r){return r==='24h'?86400000:r==='7d'?604800000:r==='30d'?2592000000:Infinity;}
// Best server over the last 24h: rank by uptime% desc, then avg response ms asc.
function renderTopServer(data){
  const main=document.getElementById('main-content'); if(!main||!Array.isArray(data)) return;
  const cutoff=Date.now()-86400000;
  const ranked=data.map(s=>{
    const h=(s.history||[]).filter(e=>e.ts>=cutoff);
    const total=h.length, up=h.filter(e=>e.up).length;
    const ups=h.filter(e=>e.up&&e.ms!=null);
    const avg=ups.length?Math.round(ups.reduce((a,e)=>a+e.ms,0)/ups.length):null;
    const label=(s.history&&s.history[0]&&s.history[0].label)||(s.url||'').replace(/^https?:\/\//,'');
    return {label, total, pct: total?Math.round(up/total*1000)/10:null, avg};
  }).filter(s=>s.total>0);
  if(!ranked.length){ const ex=document.getElementById('top-server'); if(ex) ex.remove(); return; }
  ranked.sort((a,b)=> (b.pct-a.pct) || ((a.avg??1e9)-(b.avg??1e9)));
  const t=ranked[0];
  const html=`<div id="top-server" class="top-server"><span class="ts-trophy">\u{1F3C6}</span>
    <span class="ts-text"><strong>Top server (24h)</strong> — <span class="ts-name">${esc(t.label)}</span>
    <span class="ts-stat">${t.pct!=null?t.pct+'% uptime':''}${t.avg!=null?' · '+t.avg+'ms avg':''}</span></span></div>`;
  const ex=document.getElementById('top-server'); if(ex) ex.remove();
  main.insertAdjacentHTML('afterbegin', html);
}
let _svHistory=null;
async function getServerHistory(){if(_svHistory)return _svHistory;try{_svHistory=await fetch('/api/user/server-history',{credentials:'same-origin'}).then(r=>r.json());}catch{_svHistory={servers:[]};}return _svHistory;}
function uptimePct(daily){const t=daily.reduce((a,d)=>a+d.checks,0),u=daily.reduce((a,d)=>a+d.up_checks,0);return t?Math.round(u/t*1000)/10:null;}
function setRange(r,btn){currentRange=r;document.querySelectorAll('.range-tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderPage(rawData);}
function filterH(h){if(currentRange==='all')return h;const c=Date.now()-rangeMs(currentRange);return h.filter(e=>e.ts>=c);}
async function loadHistory(){try{rawData=await fetch('/api/health/history').then(r=>r.json());renderPage(rawData);}catch{document.getElementById('main-content').innerHTML='<div class="empty-state"><span class="icon">&#x26A0;&#xFE0F;</span>Could not load health data.</div>';}}
async function pingNow(){document.getElementById('refresh-bar').textContent='Pinging&#x2026;';try{await fetch('/api/health/ping-now',{method:'POST'});await loadHistory();}catch{}}
async function hBrowserPing(url,btn,msEl){if(btn.dataset.t)return;btn.dataset.t='1';btn.textContent='&#x2026;';msEl.className='loc-ms none';msEl.textContent='&#x2014;';const t0=performance.now();try{const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),8000);await fetch(url+'/System/Ping',{signal:ctrl.signal,mode:'no-cors'});clearTimeout(timer);const ms=Math.round(performance.now()-t0);browserPings[url]=ms;msEl.textContent=ms+'ms';msEl.className='loc-ms '+(ms<100?'fast':ms<400?'ok':'slow');}catch{browserPings[url]=null;msEl.textContent='Blocked';msEl.className='loc-ms none';}btn.textContent='Retest';delete btn.dataset.t;}
function renderPage(data){const main=document.getElementById('main-content');if(!data||!data.length){main.innerHTML='<div class="notice">No servers registered. Go to <a href="/configure">Configure</a>.</div>';return;}const fd=data.map(s=>({...s,history:filterH(s.history||[])}));const up=fd.filter(s=>s.history[0]&&s.history[0].up===true).length;const dn=fd.filter(s=>s.history[0]&&s.history[0].up===false).length;const tot=fd.reduce((a,s)=>a+s.history.length,0);const rl={'24h':'last 24h','7d':'last 7 days','30d':'last 30 days','all':'all time'}[currentRange];document.getElementById('range-info').textContent=tot+' checks · '+rl;let sb='<div class="status-bar"><div>';if(!dn&&up)sb+='<span class="dot ok"></span>All '+up+' server'+(up>1?'s':'')+' online';else if(dn&&up)sb+='<span class="dot warn"></span>'+up+' online, '+dn+' offline';else if(dn)sb+='<span class="dot bad"></span>All servers offline';else sb+='<span class="dot"></span>Waiting…';sb+='</div><div style="color:#2e2e42">Pings every 5 min</div></div>';main.innerHTML=sb+'<div class="server-grid">'+fd.map(buildCard).join('')+'</div>';
  renderTopServer(data);fd.forEach(s=>{const id=encId(s.url);const btn=document.getElementById('bpbtn-'+id);const msEl=document.getElementById('bpms-'+id);if(btn&&msEl){const sv=browserPings[s.url];if(sv!==undefined){msEl.textContent=sv!==null?sv+'ms':'Blocked';msEl.className=sv!==null?'loc-ms '+(sv<100?'fast':sv<400?'ok':'slow'):'loc-ms none';btn.textContent='Retest';}btn.onclick=()=>hBrowserPing(s.url,btn,msEl);}const tog=document.getElementById('htog-'+id);const wrap=document.getElementById('hwrap-'+id);if(tog&&wrap){tog.onclick=()=>{wrap.classList.toggle('open');tog.textContent=wrap.classList.contains('open')?'▲ Hide history':'▼ Show history';};}
getServerHistory().then(hist=>{const w=document.getElementById('hwrap-'+id);if(!w||w.querySelector('.uptime-hist'))return;const m=(hist.servers||[]).find(x=>x.url===s.url.replace(/\/+$/,''));if(!m||!m.daily||!m.daily.length)return;const pct=uptimePct(m.daily);const days=m.daily.slice(0,30).reverse().map(d=>'<div class="uh-day" title="'+d.day+': '+d.up_checks+'/'+d.checks+' up"><div class="uh-bar" style="height:'+(d.checks?Math.round(d.up_checks/d.checks*100):0)+'%"></div></div>').join('');w.insertAdjacentHTML('afterbegin','<div class="uptime-hist"><div class="uh-head">Durable uptime '+(pct!=null?pct+'%':'—')+' <span class="uh-sub">'+m.daily.length+' day(s) logged</span></div><div class="uh-bars">'+days+'</div></div>');});});}
function encId(u){return u.replace(/[^a-zA-Z0-9]/g,'_');}
function buildCard(s){const h=s.history||[];const lat=h[0]||null;const state=lat?(lat.up?'up':'down'):'unknown';const us=(s.url||'').replace(/^https?:\/\//,'');const tl=s.type==='jellyfin'?'Jellyfin':'Emby';const pCls=lat&&lat.ms!=null?(lat.ms<100?'fast':lat.ms<400?'ok':'slow'):'';const pTxt=lat&&lat.ms!=null?lat.ms+'ms':'';const st=state==='up'?'Online':state==='down'?'Offline':'Pending…';const id=encId(s.url);const rtp=h.filter(e=>e.up&&e.ms!=null).slice(0,80).reverse();const avg=rtp.length?Math.round(rtp.reduce((a,e)=>a+e.ms,0)/rtp.length):null;const rows=h.slice(0,20).map(e=>'<tr><td>'+esc(new Date(e.ts).toLocaleString())+'</td><td class="'+(e.up?'h-up':'h-down')+'">'+(e.up?'Online · '+e.ms+'ms':'Offline')+'</td></tr>').join('');const upParts=buildUptimeBar(h,SEGMENTS,'seg','uptime-legend','uptime-bar','card-footer');
return '<div class="server-card '+state+'">'+
  '<div class="card-header"><div class="card-name-row"><span class="card-name">'+esc(s.label||us)+'</span><span class="card-type">'+tl+'</span></div></div>'+
  '<div class="card-url" title="'+esc(s.url)+'">'+esc(us)+'</div>'+
  '<div class="status-row"><div class="status-dot '+state+'"></div><span class="status-label '+state+'">'+st+'</span>'+(pTxt?'<span class="ping-ms '+pCls+'">'+pTxt+'</span>':'')+'</div>'+
  '<div class="ping-locations">'+
    '<div class="ping-loc"><span class="loc-label">&#x1F4E1; Server</span><span class="loc-ms '+pCls+'">'+(pTxt||'—')+'</span></div>'+
    '<div class="ping-loc"><span class="loc-label">&#x1F4BB; You</span><span class="loc-ms none" id="bpms-'+id+'">—</span><button class="browser-ping-btn" id="bpbtn-'+id+'">Test</button></div>'+
    (avg?'<div class="ping-loc"><span class="loc-label">∅ Avg</span><span class="loc-ms '+(avg<100?'fast':avg<400?'ok':'slow')+'">'+avg+'ms</span></div>':'')+
  '</div>'+
  upParts.spark+upParts.legend+upParts.bar+upParts.foot+
  (rows?'<div class="history-toggle" id="htog-'+id+'">▼ Show history</div><div class="history-table-wrap" id="hwrap-'+id+'"><table class="history-table"><thead><tr><th>Time</th><th>Result</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'')+
'</div>';}
function buildSpark(pts, cls){
  if(pts.length<2)return'';
  const wrap=cls||'rt-graph-wrap';
  const vals=pts.map(p=>p.ms);
  const mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1;
  const W=400,H=44,p=3;
  const pp=vals.map((v,i)=>((p+(i/(vals.length-1))*(W-p*2)).toFixed(1))+','+(H-p-((v-mn)/rng)*(H-p*2)).toFixed(1)).join(' ');
  const lv=vals[vals.length-1];
  const col=lv<100?'#4caf7d':lv<400?'#f0a500':'#e05555';
  const lx=(p+(W-p*2)).toFixed(1);
  const ly=(H-p-((lv-mn)/rng)*(H-p*2)).toFixed(1);
  return'<div class="'+wrap+'"><div class="rt-graph-label"><span>Response time</span><span>'+mn+'ms – '+mx+'ms</span></div><svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none"><polyline points="'+pp+'" fill="none" stroke="'+col+'" stroke-width="1.5" stroke-linejoin="round" opacity="0.85"/><circle cx="'+lx+'" cy="'+ly+'" r="3" fill="'+col+'"/></svg></div>';
}
function buildUptimeBar(h, segments, segCls, legendCls, barCls, footCls){
  if(!h||!h.length){
    return { spark:'', legend:'', bar:'', foot:'<div class="'+(footCls||'gcard-health-foot')+'"><span>Waiting for first health check…</span></div>' };
  }
  const slots=h.slice().reverse().slice(-segments);
  const pad=Array(segments-slots.length).fill(null).concat(slots);
  const uc=h.filter(e=>e.up).length;
  const pct=h.length?Math.round(uc/h.length*100):null;
  const old=h.length?new Date(h[h.length-1].ts).toLocaleDateString():'—';
  const rtp=h.filter(e=>e.up&&e.ms!=null).slice(0,80).reverse();
  const spark=buildSpark(rtp, 'gcard-rt-graph');
  const bar=pad.map(e=>{
    if(!e)return '<div class="'+(segCls||'gcard-seg')+' empty" title="No data"></div>';
    const ts=new Date(e.ts).toLocaleString();
    const tip=e.up?ts+' · Online ('+e.ms+'ms)':ts+' · Offline';
    return '<div class="'+(segCls||'gcard-seg')+' '+(e.up?'up':'down')+'" title="'+esc(tip)+'"></div>';
  }).join('');
  const lt=h[0]?new Date(h[0].ts).toLocaleTimeString():'Never';
  const useHi=footCls==='card-footer';
  const hiOpen=useHi?'<span class="highlight">':'<strong>';
  const hiClose=useHi?'</span>':'</strong>';
  return {
    spark,
    legend:'<div class="'+(legendCls||'gcard-uptime-legend')+'"><span>'+old+'</span><span>'+(pct!==null?pct+'% uptime · '+h.length+' checks':'No history yet')+'</span><span>Now</span></div>',
    bar:'<div class="'+(barCls||'gcard-uptime-bar')+'">'+bar+'</div>',
    foot:'<div class="'+(footCls||'gcard-health-foot')+'"><span>Last checked: '+hiOpen+lt+hiClose+'</span>'+(pct!==null?'<span>Up: '+hiOpen+uc+'/'+h.length+hiClose+'</span>':'')+'</div>',
  };
}
function buildMiniHealthPanel(history, opts){
  const range=opts&&opts.range||'24h';
  const segments=(opts&&opts.segments)||48;
  let h=history||[];
  if(range==='24h') h=h.filter(e=>e.ts>=Date.now()-86400000);
  else if(range==='7d') h=h.filter(e=>e.ts>=Date.now()-604800000);
  const parts=buildUptimeBar(h, segments);
  if(!h.length) return '<div class="gcard-health-empty">Collecting health data — pings run every 5 min</div>';
  return parts.spark+parts.legend+parts.bar+parts.foot;
}
window.HealthWidgets={ SEGMENTS, buildSpark, buildUptimeBar, buildMiniHealthPanel, esc };
function startCountdown(){clearInterval(refreshTimer);countdown=60;refreshTimer=setInterval(()=>{countdown--;document.getElementById('refresh-bar').textContent='Auto-refresh in '+countdown+'s · Backend pings every 5 min';if(countdown<=0){countdown=60;loadHistory();}},1000);}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
async function loadServerInfo(){try{const info=await fetch('/api/server-info').then(r=>r.json());const pill=document.getElementById('ping-origin-pill');if(pill)pill.textContent=info.region?'Addon Server · '+info.region:'Addon Server (Railway)';}catch{}}
let healthStarted = false;
function startHealth() {
  if (healthStarted) return;
  healthStarted = true;
  loadHistory();
  loadServerInfo();
  startCountdown();
}
window.startHealth = startHealth;
