const state = {
  data: { meta: {}, jobs: [] },
  jobs: [],
  filtered: [],
  center: null,
  userPosition: null,
  radius: 25,
  filter: 'all',
  query: '',
  selectedSources: new Set(),
  availableSources: [],
  favorites: new Set(JSON.parse(localStorage.getItem('jobRadarFavorites') || '[]')),
  selectedJobId: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  query: $('queryInput'), location: $('locationInput'), radius: $('radiusSelect'), search: $('searchBtn'), locate: $('locateBtn'),
  mapLocate: $('mapLocateBtn'), clearQuery: $('clearQuery'), results: $('resultsList'), count: $('resultCount'), context: $('resultContext'),
  updateText: $('updateText'), sourceSummary: $('sourceSummary'), sort: $('sortSelect'), filterRow: $('filterRow'),
  sourceFilterBtn: $('sourceFilterBtn'), sourceModal: $('sourceModal'), sourceOptions: $('sourceOptions'), allSourcesBtn: $('allSourcesBtn'),
  jobModal: $('jobModal'), jobTitle: $('jobModalTitle'), jobCompany: $('jobModalCompany'), jobSource: $('jobModalSource'),
  jobMeta: $('jobModalMeta'), jobDescription: $('jobModalDescription'), jobSources: $('jobModalSources'), jobApply: $('jobApplyBtn'),
  jobFavorite: $('jobFavoriteBtn'), fitBtn: $('fitBtn'), mobileListToggle: $('mobileListToggle'), mobileCount: $('mobileCount'),
  resultsPanel: $('resultsPanel'), toast: $('toast')
};

const BERLIN = [52.5200, 13.4050];
const map = L.map('map', { zoomControl: true, preferCanvas: true, minZoom: 6 }).setView(BERLIN, 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const markers = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 48, showCoverageOnHover: false, spiderfyOnMaxZoom: true });
map.addLayer(markers);
let centerMarker = null;
let radiusCircle = null;
const markerById = new Map();

const pinIcon = L.divIcon({
  className: 'job-marker',
  html: '<div class="job-pin"><span>●</span></div>',
  iconSize: [31, 31], iconAnchor: [15, 30], popupAnchor: [0, -28]
});

function escapeHtml(value='') {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch]));
}
function stripHtml(value='') {
  const div = document.createElement('div'); div.innerHTML = value; return (div.textContent || '').replace(/\s+/g,' ').trim();
}
function shortSource(name='') {
  return name.replace('Bundesagentur für Arbeit','Arbeitsagentur').replace('Berliner Morgenpost Jobs','Morgenpost').replace('Tagesspiegel Jobs','Tagesspiegel').replace('Berliner Zeitung Jobmarkt','Berliner Zeitung').replace('Bluum Brandenburg','bluum');
}
function formatDate(value) {
  if (!value) return '';
  const d = new Date(value); if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
}
function ageInDays(value) {
  if (!value) return 999;
  const t = new Date(value).getTime(); return Number.isFinite(t) ? Math.floor((Date.now()-t)/86400000) : 999;
}
function kmDistance(a,b) {
  if (!a || !b) return Infinity;
  const R=6371, rad=x=>x*Math.PI/180, dLat=rad(b[0]-a[0]), dLon=rad(b[1]-a[1]);
  const q=Math.sin(dLat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}
function jobCoords(job){ return Number.isFinite(job.lat) && Number.isFinite(job.lon) ? [job.lat,job.lon] : null; }
function jobTypesText(job){ return Array.isArray(job.employmentType) ? job.employmentType.join(' ').toLowerCase() : String(job.employmentType||'').toLowerCase(); }
function matchesWorkFilter(job, filter){
  const t=jobTypesText(job); const title=(job.title||'').toLowerCase();
  if(filter==='fulltime') return /vollzeit|full.?time/.test(t+title);
  if(filter==='parttime') return /teilzeit|part.?time/.test(t+title);
  if(filter==='minijob') return /minijob|aushilfe|geringfüg/.test(t+title);
  if(filter==='remote') return job.remote || /homeoffice|remote|tele.?arbeit|hybrid/.test(t+title);
  if(filter==='favorites') return state.favorites.has(job.id);
  return true;
}
function normalizeSearchText(v=''){ return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function matchesQuery(job,q){
  if(!q) return true;
  const hay=normalizeSearchText([job.title,job.company,job.location,job.description,(job.employmentType||[]).join?.(' ')].filter(Boolean).join(' '));
  return normalizeSearchText(q).split(/\s+/).filter(Boolean).every(part=>hay.includes(part));
}
function selectedSourcesAllow(job){
  if(!state.selectedSources.size) return true;
  const names=(job.sources||[{name:job.source}]).map(s=>s.name);
  return names.some(n=>state.selectedSources.has(n));
}

function saveFavorites(){ localStorage.setItem('jobRadarFavorites',JSON.stringify([...state.favorites])); }
function toggleFavorite(id){
  if(state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
  saveFavorites(); renderResults(); if(state.selectedJobId===id) updateFavoriteButton(id);
}
function updateFavoriteButton(id){ const active=state.favorites.has(id); els.jobFavorite.textContent=active?'★ Gemerkt':'☆ Merken'; }

function setCenter(lat,lon,label='Ausgewählter Ort',zoom=true){
  state.center=[lat,lon];
  if(centerMarker) map.removeLayer(centerMarker);
  if(radiusCircle) map.removeLayer(radiusCircle);
  centerMarker=L.circleMarker(state.center,{radius:7,weight:3,color:'#ffffff',fillColor:'#4ab9ff',fillOpacity:1}).addTo(map).bindTooltip(label);
  radiusCircle=L.circle(state.center,{radius:state.radius*1000,weight:1,color:'#64f4bb',fillColor:'#64f4bb',fillOpacity:.035,dashArray:'5 6'}).addTo(map);
  if(zoom) map.fitBounds(radiusCircle.getBounds(),{padding:[20,20],maxZoom:12});
}

async function geocodeLocation(query){
  const url=new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format','jsonv2'); url.searchParams.set('limit','1'); url.searchParams.set('countrycodes','de'); url.searchParams.set('q',query);
  const res=await fetch(url,{headers:{'Accept-Language':'de'}}); if(!res.ok) throw new Error('Ortssuche fehlgeschlagen');
  const data=await res.json(); if(!data.length) throw new Error('Ort nicht gefunden');
  return {lat:Number(data[0].lat),lon:Number(data[0].lon),label:data[0].display_name};
}

function useCurrentLocation(){
  if(!navigator.geolocation){ showToast('Standort wird von diesem Browser nicht unterstützt.'); return; }
  els.locate.disabled=true;
  navigator.geolocation.getCurrentPosition(pos=>{
    els.locate.disabled=false;
    const {latitude,longitude}=pos.coords; state.userPosition=[latitude,longitude]; els.location.value='Mein Standort';
    setCenter(latitude,longitude,'Mein Standort'); applyFilters();
  },err=>{ els.locate.disabled=false; showToast(err.code===1?'Standortzugriff wurde nicht erlaubt.':'Standort konnte nicht ermittelt werden.'); },{enableHighAccuracy:true,timeout:10000,maximumAge:300000});
}

async function runSearch(){
  state.query=els.query.value.trim(); state.radius=Number(els.radius.value)||25;
  const loc=els.location.value.trim();
  try{
    if(loc && loc!=='Mein Standort'){
      els.search.disabled=true; els.search.textContent='Suche Ort …'; const found=await geocodeLocation(loc); setCenter(found.lat,found.lon,loc); els.location.value=loc;
    } else if(state.center){ setCenter(state.center[0],state.center[1],loc||'Suchzentrum',false); }
    applyFilters();
  }catch(e){showToast(e.message||'Ort konnte nicht gefunden werden.');}
  finally{els.search.disabled=false;els.search.textContent='Jobs finden';}
}

function applyFilters(){
  const q=state.query || els.query.value.trim(); state.query=q; state.radius=Number(els.radius.value)||25;
  const center=state.center;
  state.filtered=state.jobs.filter(job=>{
    if(!matchesQuery(job,q) || !matchesWorkFilter(job,state.filter) || !selectedSourcesAllow(job)) return false;
    if(center){ const coords=jobCoords(job); if(!coords) return false; if(kmDistance(center,coords)>state.radius) return false; }
    return true;
  });
  sortJobs(); renderResults(); renderMarkers(); updateCounts();
}
function sortJobs(){
  const mode=els.sort.value;
  state.filtered.sort((a,b)=>{
    if(mode==='newest') return new Date(b.publishedAt||0)-new Date(a.publishedAt||0);
    if(mode==='title') return (a.title||'').localeCompare(b.title||'','de');
    if(state.center){ return kmDistance(state.center,jobCoords(a))-kmDistance(state.center,jobCoords(b)); }
    return new Date(b.publishedAt||0)-new Date(a.publishedAt||0);
  });
}
function updateCounts(){
  const n=state.filtered.length; els.count.textContent=`${n.toLocaleString('de-DE')} ${n===1?'Stelle':'Stellen'}`; els.mobileCount.textContent=n.toLocaleString('de-DE');
  if(state.center) els.context.textContent=`im Umkreis von ${state.radius} km`; else els.context.textContent='in Berlin & Brandenburg';
}

function renderResults(){
  if(!state.filtered.length){
    els.results.innerHTML='<div class="empty-state"><div><div class="empty-icon">⌖</div><strong>Keine passenden Stellen gefunden</strong><div>Vergrößere den Umkreis oder ändere deine Filter.</div></div></div>'; return;
  }
  const frag=document.createDocumentFragment();
  for(const job of state.filtered){
    const card=document.createElement('article'); card.className='job-card'+(state.selectedJobId===job.id?' selected':''); card.dataset.id=job.id;
    const coords=jobCoords(job), d=state.center&&coords?kmDistance(state.center,coords):null, isNew=ageInDays(job.publishedAt)<=2;
    const srcs=(job.sources||[{name:job.source}]).slice(0,2).map(s=>`<span class="source-badge">${escapeHtml(shortSource(s.name||''))}</span>`).join('');
    const extra=(job.sources?.length||1)>2?`<span class="source-badge">+${job.sources.length-2}</span>`:'';
    card.innerHTML=`
      <div class="job-card-top"><div class="job-card-main"><h3 class="job-title">${escapeHtml(job.title||'Stellenangebot')}</h3><p class="job-company">${escapeHtml(job.company||'Arbeitgeber nicht angegeben')}</p></div><button class="fav-btn ${state.favorites.has(job.id)?'active':''}" aria-label="Stelle merken">${state.favorites.has(job.id)?'★':'☆'}</button></div>
      <div class="job-meta"><span class="job-meta-item">◎ ${escapeHtml(job.location||'Ort nicht angegeben')}</span>${job.publishedAt?`<span class="job-meta-item">◷ ${escapeHtml(formatDate(job.publishedAt))}</span>`:''}${job.remote?'<span class="job-meta-item">⌂ Homeoffice</span>':''}</div>
      <div class="job-bottom"><div class="source-badges">${isNew?'<span class="new-badge">NEU</span>':''}${srcs}${extra}</div>${Number.isFinite(d)?`<span class="distance">${d<10?d.toFixed(1):Math.round(d)} km</span>`:''}</div>`;
    card.querySelector('.fav-btn').addEventListener('click',e=>{e.stopPropagation();toggleFavorite(job.id);});
    card.addEventListener('click',()=>openJob(job.id)); frag.appendChild(card);
  }
  els.results.replaceChildren(frag);
}

function renderMarkers(){
  markers.clearLayers(); markerById.clear();
  for(const job of state.filtered){
    const coords=jobCoords(job); if(!coords) continue;
    const marker=L.marker(coords,{icon:pinIcon,title:job.title||'Job'});
    marker.bindPopup(`<div class="map-popup"><h3>${escapeHtml(job.title||'Stellenangebot')}</h3><p>${escapeHtml(job.company||'')}<br>${escapeHtml(job.location||'')}</p><button type="button" data-open-job="${escapeHtml(job.id)}">Details ansehen</button></div>`);
    marker.on('popupopen',()=>{setTimeout(()=>{document.querySelector(`[data-open-job="${CSS.escape(job.id)}"]`)?.addEventListener('click',()=>openJob(job.id));},0);});
    marker.on('click',()=>{state.selectedJobId=job.id;}); markers.addLayer(marker); markerById.set(job.id,marker);
  }
  els.sourceSummary.textContent=`${markerById.size.toLocaleString('de-DE')} davon direkt auf der Karte · ${state.filtered.length-markerById.size} ohne genaue Koordinate`;
}

function openJob(id){
  const job=state.jobs.find(j=>j.id===id); if(!job) return; state.selectedJobId=id; renderResults();
  els.jobTitle.textContent=job.title||'Stellenangebot'; els.jobCompany.textContent=job.company||'Arbeitgeber nicht angegeben'; els.jobSource.textContent=shortSource((job.sources?.[0]?.name)||job.source||'Quelle');
  const meta=[]; if(job.location) meta.push(`◎ ${job.location}`); if(job.publishedAt) meta.push(`◷ ${formatDate(job.publishedAt)}`); if(job.remote) meta.push('⌂ Homeoffice / Hybrid');
  for(const t of job.employmentType||[]) if(t) meta.push(t); if(job.salary) meta.push(`€ ${job.salary}`);
  els.jobMeta.innerHTML=meta.map(x=>`<span class="meta-pill">${escapeHtml(x)}</span>`).join('');
  const desc=stripHtml(job.description||''); els.jobDescription.innerHTML=desc?`<p>${escapeHtml(desc.slice(0,5000))}</p>`:'<p>Für diese Quelle liegt keine Kurzbeschreibung vor. Öffne die Stellenanzeige für alle Details.</p>';
  const sources=job.sources?.length?job.sources:[{name:job.source,url:job.url}];
  els.jobSources.innerHTML='<h3>Gefunden bei</h3>'+sources.map(s=>`<a class="source-link" href="${escapeHtml(s.url||job.url||'#')}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(s.name||'Quelle')}</span><span>↗</span></a>`).join('');
  els.jobApply.href=job.url||sources[0]?.url||'#'; updateFavoriteButton(id); els.jobModal.hidden=false;
  const marker=markerById.get(id); if(marker){ markers.zoomToShowLayer(marker,()=>marker.openPopup()); }
}
function closeJob(){ els.jobModal.hidden=true; }

function buildSourceOptions(){
  const counts=new Map(); for(const j of state.jobs){for(const s of (j.sources||[{name:j.source}])) counts.set(s.name,(counts.get(s.name)||0)+1);}
  state.availableSources=[...counts.keys()].filter(Boolean).sort((a,b)=>a.localeCompare(b,'de'));
  els.sourceOptions.innerHTML=state.availableSources.map(name=>`<div class="source-option"><label><input type="checkbox" value="${escapeHtml(name)}" ${!state.selectedSources.size||state.selectedSources.has(name)?'checked':''}><span>${escapeHtml(name)}</span></label><small>${counts.get(name).toLocaleString('de-DE')}</small></div>`).join('');
}
function applySourceOptions(){
  const checks=[...els.sourceOptions.querySelectorAll('input[type="checkbox"]')]; const selected=checks.filter(c=>c.checked).map(c=>c.value);
  state.selectedSources=new Set(selected.length===state.availableSources.length?[]:selected); els.sourceFilterBtn.classList.toggle('has-filter',state.selectedSources.size>0); applyFilters();
}

function fitVisible(){
  const coords=state.filtered.map(jobCoords).filter(Boolean); if(!coords.length) return;
  map.fitBounds(L.latLngBounds(coords),{padding:[35,35],maxZoom:13});
}
function showToast(text){els.toast.textContent=text;els.toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>els.toast.classList.remove('show'),2600);}

async function loadData(){
  try{
    const res=await fetch(`./data/jobs.json?v=${Date.now()}`,{cache:'no-store'}); if(!res.ok) throw new Error(`HTTP ${res.status}`); state.data=await res.json(); state.jobs=Array.isArray(state.data.jobs)?state.data.jobs:[];
    const when=state.data.meta?.generatedAt?new Date(state.data.meta.generatedAt):null;
    els.updateText.textContent=when&&!Number.isNaN(when.getTime())?`Aktualisiert ${new Intl.DateTimeFormat('de-DE',{dateStyle:'short',timeStyle:'short'}).format(when)}`:'Noch kein täglicher Import';
    buildSourceOptions(); applyFilters();
    if(!state.jobs.length) showToast('Der erste Job-Import läuft über GitHub Actions.');
  }catch(e){els.updateText.textContent='Jobdaten konnten nicht geladen werden'; els.results.innerHTML='<div class="empty-state"><div><strong>Datenfehler</strong><div>public/data/jobs.json konnte nicht geladen werden.</div></div></div>'; console.error(e);}
}

els.search.addEventListener('click',runSearch); els.query.addEventListener('keydown',e=>{if(e.key==='Enter')runSearch();}); els.location.addEventListener('keydown',e=>{if(e.key==='Enter')runSearch();});
els.clearQuery.addEventListener('click',()=>{els.query.value='';state.query='';applyFilters();els.query.focus();}); els.locate.addEventListener('click',useCurrentLocation); els.mapLocate.addEventListener('click',()=>{if(state.userPosition)setCenter(...state.userPosition,'Mein Standort');else useCurrentLocation();});
els.radius.addEventListener('change',()=>{state.radius=Number(els.radius.value);if(state.center)setCenter(...state.center,'Suchzentrum',false);applyFilters();}); els.sort.addEventListener('change',()=>{sortJobs();renderResults();});
els.filterRow.addEventListener('click',e=>{const btn=e.target.closest('[data-filter]');if(!btn)return; state.filter=btn.dataset.filter; [...els.filterRow.querySelectorAll('[data-filter]')].forEach(x=>x.classList.toggle('active',x===btn));applyFilters();});
els.sourceFilterBtn.addEventListener('click',()=>{buildSourceOptions();els.sourceModal.hidden=false;}); els.sourceModal.querySelectorAll('[data-close-source]').forEach(b=>b.addEventListener('click',()=>{applySourceOptions();els.sourceModal.hidden=true;}));
els.allSourcesBtn.addEventListener('click',()=>{els.sourceOptions.querySelectorAll('input').forEach(x=>x.checked=true);}); els.sourceModal.addEventListener('click',e=>{if(e.target===els.sourceModal){applySourceOptions();els.sourceModal.hidden=true;}});
els.jobModal.querySelectorAll('[data-close-job]').forEach(b=>b.addEventListener('click',closeJob)); els.jobModal.addEventListener('click',e=>{if(e.target===els.jobModal)closeJob();}); els.jobFavorite.addEventListener('click',()=>{if(state.selectedJobId)toggleFavorite(state.selectedJobId);});
els.fitBtn.addEventListener('click',fitVisible); els.mobileListToggle.addEventListener('click',()=>els.resultsPanel.classList.toggle('mobile-open')); els.results.addEventListener('click',()=>{if(matchMedia('(max-width:850px)').matches)els.resultsPanel.classList.remove('mobile-open');});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){els.sourceModal.hidden=true;closeJob();els.resultsPanel.classList.remove('mobile-open');}});

if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
loadData();
