import {loadFavoriteKeys,isFavorite,toggleFavorite,replaceFavoriteKeys} from './favorite-store.js';

const NEW_WINDOW_MS=7*24*60*60*1000;
const BERLIN_TIME_ZONE='Europe/Berlin';
const READ_STORAGE='jobRadarReadNewJobsV1';

const esc=(v='')=>String(v).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch]));
const formatDate=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',timeZone:BERLIN_TIME_ZONE}).format(d);};
function berlinDayNumber(v){const d=new Date(v);if(Number.isNaN(d.getTime()))return NaN;const p=Object.fromEntries(new Intl.DateTimeFormat('en',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:BERLIN_TIME_ZONE}).formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,+x.value]));return Math.floor(Date.UTC(p.year,p.month-1,p.day)/86400000);}
const isSeniorJob=j=>/\bsenior|\bsr\b/i.test(String(j?.title||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' '));
const firstSeenMs=j=>new Date(j.firstSeenAt||0).getTime();
const token=j=>`${j.id||[j.company,j.title,j.url].filter(Boolean).join('|')}::${j.firstSeenAt||''}`;
function safeUrl(v=''){try{const u=new URL(v,location.href);return /^https?:$/.test(u.protocol)?u.href:'#';}catch{return'#';}}
function loadRead(){try{const value=JSON.parse(localStorage.getItem(READ_STORAGE)||'[]');return new Set(Array.isArray(value)?value:[]);}catch{return new Set();}}
function saveRead(read){localStorage.setItem(READ_STORAGE,JSON.stringify([...read].slice(-1500)));}
function addedLabel(v){const days=Math.max(0,berlinDayNumber(new Date())-berlinDayNumber(v));if(days===0)return'Heute neu';if(days===1)return'Gestern neu';return`Vor ${days} Tagen neu`;}
function placeLabel(j){return j.remoteFull===true?'⌂ 100 % Homeoffice':`◎ ${j.location||'Ort nicht angegeben'}`;}

function buildPopup(jobs,read,favorites){
  const backdrop=document.createElement('div');
  backdrop.className='new-jobs-backdrop';
  backdrop.setAttribute('role','presentation');
  backdrop.innerHTML=`
    <section class="new-jobs-modal" role="dialog" aria-modal="true" aria-labelledby="newJobsTitle">
      <header class="new-jobs-head">
        <div>
          <div class="new-jobs-kicker">● Neu im Radar</div>
          <h2 id="newJobsTitle">Neue Jobs dieser Woche · <span data-new-count>${jobs.length}</span></h2>
          <p>Lokale Stellen stehen zuerst. Reine Homeoffice-Stellen sind darunter platzsparend eingeklappt. Mit ★ kannst du Jobs direkt dauerhaft als Favorit speichern.</p>
        </div>
        <button class="new-jobs-close" type="button" aria-label="Popup schließen">×</button>
      </header>
      <div class="new-jobs-list"></div>
      <footer class="new-jobs-actions">
        <div class="new-jobs-note">★ Favoriten bleiben gespeichert. × schließt nur das Fenster. „Gelesen“ entfernt die Stelle aus diesem Wochen-Popup.</div>
        <button class="new-jobs-read-all" type="button">Alle als gelesen markieren</button>
      </footer>
    </section>`;

  const list=backdrop.querySelector('.new-jobs-list');
  const countEl=backdrop.querySelector('[data-new-count]');
  const readAll=backdrop.querySelector('.new-jobs-read-all');
  const rows=new Map();
  const localJobs=jobs.filter(j=>j.remoteFull!==true);
  const remoteJobs=jobs.filter(j=>j.remoteFull===true);

  const localGroup=document.createElement('section');
  localGroup.className='new-jobs-group new-jobs-group-local';
  localGroup.dataset.jobGroup='local';
  localGroup.innerHTML=`<div class="new-jobs-group-title"><span>◎ Lokal · bis 15 km</span><strong>${localJobs.length}</strong></div><div class="new-jobs-group-list"></div>`;
  if(localJobs.length)list.appendChild(localGroup);

  const remoteGroup=document.createElement('details');
  remoteGroup.className='new-jobs-group new-jobs-group-remote';
  remoteGroup.dataset.jobGroup='remote';
  remoteGroup.innerHTML=`
    <summary class="new-jobs-group-summary">
      <span class="new-jobs-group-icon" aria-hidden="true">+</span>
      <span class="new-jobs-group-summary-text"><strong>⌂ 100 % Homeoffice</strong><small>Nicht lokal · zum Aufklappen</small></span>
      <span class="new-jobs-group-count">${remoteJobs.length}</span>
    </summary>
    <div class="new-jobs-group-list"></div>`;
  if(remoteJobs.length)list.appendChild(remoteGroup);

  function syncFavorite(job,row){
    const fav=isFavorite(job,favorites),btn=row.querySelector('.new-job-fav');
    row.classList.toggle('favorite',fav);
    btn.classList.toggle('active',fav);
    btn.textContent=fav?'★':'☆';
    btn.setAttribute('aria-label',fav?'Favorit entfernen':'Als Favorit speichern');
    btn.title=fav?'Favorit entfernen':'Als Favorit speichern';
  }
  function onFavoriteChange(e){
    replaceFavoriteKeys(favorites,e.detail?.keys||[]);
    for(const [job,row] of rows)if(document.body.contains(row))syncFavorite(job,row);
  }
  window.addEventListener('jobradar:favorites-changed',onFavoriteChange);

  function close(){window.removeEventListener('jobradar:favorites-changed',onFavoriteChange);backdrop.remove();}
  function updateGroups(){
    const localLeft=localGroup.querySelectorAll('.new-job-row').length;
    const remoteLeft=remoteGroup.querySelectorAll('.new-job-row').length;
    localGroup.hidden=localLeft===0;
    remoteGroup.hidden=remoteLeft===0;
    const localCount=localGroup.querySelector('.new-jobs-group-title strong');
    const remoteCount=remoteGroup.querySelector('.new-jobs-group-count');
    if(localCount)localCount.textContent=String(localLeft);
    if(remoteCount)remoteCount.textContent=String(remoteLeft);
  }
  function updateCount(){
    const left=list.querySelectorAll('.new-job-row').length;
    countEl.textContent=String(left);
    updateGroups();
    if(left===0){list.innerHTML='<div class="new-jobs-empty"><strong>Alles gelesen ✓</strong>Für diese Woche sind keine ungelesenen neuen Jobs mehr übrig.</div>';readAll.disabled=true;setTimeout(close,650);}
  }
  function markOne(job,row){read.add(token(job));saveRead(read);rows.delete(job);row.remove();updateCount();}

  function createRow(j){
    const row=document.createElement('article');
    row.className='new-job-row';
    row.innerHTML=`
      <div class="new-job-main">
        <div class="new-job-topline"><span class="new-job-badge">NEU</span><h3 class="new-job-title">${esc(j.title||'Stellenangebot')}</h3></div>
        <p class="new-job-company">${esc(j.company||'Arbeitgeber nicht angegeben')}</p>
        <div class="new-job-meta"><span>${esc(placeLabel(j))}</span><span>◷ ${esc(addedLabel(j.firstSeenAt))}</span>${j.publishedAt?`<span>Anzeige: ${esc(formatDate(j.publishedAt))}</span>`:''}</div>
      </div>
      <div class="new-job-actions">
        <button class="new-job-fav" type="button" aria-label="Als Favorit speichern" title="Als Favorit speichern">☆</button>
        <a class="new-job-open" href="${esc(safeUrl(j.url||j.sources?.[0]?.url||''))}" target="_blank" rel="noopener noreferrer">Stelle öffnen ↗</a>
        <button class="new-job-read" type="button">Gelesen ✓</button>
      </div>`;
    rows.set(j,row);
    syncFavorite(j,row);
    row.querySelector('.new-job-fav').addEventListener('click',async()=>{await toggleFavorite(j,favorites);syncFavorite(j,row);});
    row.querySelector('.new-job-read').addEventListener('click',()=>markOne(j,row));
    return row;
  }

  const localList=localGroup.querySelector('.new-jobs-group-list');
  const remoteList=remoteGroup.querySelector('.new-jobs-group-list');
  for(const j of localJobs)localList.appendChild(createRow(j));
  for(const j of remoteJobs)remoteList.appendChild(createRow(j));

  backdrop.querySelector('.new-jobs-close').addEventListener('click',close);
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)close();});
  readAll.addEventListener('click',()=>{for(const j of jobs)read.add(token(j));saveRead(read);close();});
  document.addEventListener('keydown',function onKey(e){if(e.key==='Escape'&&document.body.contains(backdrop)){close();document.removeEventListener('keydown',onKey);}});
  document.body.appendChild(backdrop);
}

async function initNewJobs(){
  try{
    const r=await fetch(`./data/jobs.json?v=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)return;
    const payload=await r.json();
    const allJobs=Array.isArray(payload.jobs)?payload.jobs:[];
    const now=Date.now();
    const read=loadRead();
    const favorites=await loadFavoriteKeys(allJobs);
    const jobs=allJobs
      .filter(j=>!isSeniorJob(j)&&Number.isFinite(firstSeenMs(j))&&firstSeenMs(j)>0&&now-firstSeenMs(j)>=0&&now-firstSeenMs(j)<NEW_WINDOW_MS&&!read.has(token(j)))
      .sort((a,b)=>firstSeenMs(b)-firstSeenMs(a));
    if(jobs.length)buildPopup(jobs,read,favorites);
  }catch{}
}

initNewJobs();
