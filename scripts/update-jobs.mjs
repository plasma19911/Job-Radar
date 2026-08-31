import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT=process.cwd();
const OUT=path.join(ROOT,'public/data/jobs.json');
const CACHE_PATH=path.join(ROOT,'data/geocode-cache.json');
const USER_AGENT='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const NOW=new Date();
const MAX_AGE_DAYS=45;
const GEOCODE_LIMIT=65;
let geocodeCount=0;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const stripHtml=v=>clean(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>'));
const uniq=a=>[...new Set(a.filter(Boolean))];
const isoDate=v=>{ if(!v)return null; const d=new Date(v); return Number.isNaN(d.getTime())?null:d.toISOString(); };
const daysOld=v=>{const d=new Date(v||0);return Number.isNaN(d.getTime())?9999:(Date.now()-d.getTime())/86400000;};
const hash=v=>crypto.createHash('sha1').update(v).digest('hex').slice(0,18);
const num=v=>(v===null||v===undefined||v==='')?null:(Number.isFinite(Number(v))?Number(v):null);

function normalize(v=''){
  return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(m|w|d|gn|all genders|divers)[\/\-\s]*\b/g,' ').replace(/[^a-z0-9äöüß]+/g,' ').replace(/\s+/g,' ').trim();
}
function normalizeCompany(v=''){
  return normalize(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|ev|e v|co|und co|gruppe|group)\b/g,' ').replace(/\s+/g,' ').trim();
}
function isTraining(job){
  const text=normalize(`${job.title||''} ${(job.employmentType||[]).join?.(' ')||''}`);
  return /(ausbildung|ausbildungsplatz|auszubildende|auszubildender|auszubildenden|azubi|lehrstelle|duales studium|dual studium|dualstudent|berufsausbildung)/i.test(text);
}
function titleTokens(v){return new Set(normalize(v).split(' ').filter(x=>x.length>2&&!['fur','der','die','das','mit','und','als','bei','von'].includes(x)));}
function similarity(a,b){const A=titleTokens(a),B=titleTokens(b);if(!A.size||!B.size)return 0;let inter=0;for(const x of A)if(B.has(x))inter++;return inter/Math.max(A.size,B.size);}
function inRegionByCoords(lat,lon){return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=51.30&&lat<=53.70&&lon>=11.10&&lon<=14.90;}
const REGION_WORDS=[
  'berlin','brandenburg','potsdam','cottbus','frankfurt (oder)','frankfurt/oder','brandenburg an der havel','oranie','oranienburg','eberswalde','bernau','konigs wusterhausen','königs wusterhausen','ludwigsfelde','teltow','schonefeld','schönefeld','wildau','hennigsdorf','falkensee','strausberg','neuenhagen','hoppegarten','erkner','furstenwalde','fürstenwalde','beelitz','luckenwalde','juterbog','jüterbog','nauen','rathenow','neuruppin','prenzlau','schwedt','senftenberg','finsterwalde','lubben','lübben','lubbenau','lübbenau','eisenhuttenstadt','eisenhüttenstadt','bad belzig','velten','wandlitz','zeuthen','kleinmachnow','stahnsdorf','blankenfelde','mahlow','grossbeeren','großbeeren','zossen','mittenwalde','wustermark','werder','luckau','seelow','mullrose','müllrose','schwarzheide','laucha','lauchhammer','spremberg','forst (lausitz)','herzberg','teltow-flaming','teltow-fläming','oberhavel','barnim','markisch-oderland','märkisch-oderland','havelland','uckermark','prignitz','ostprignitz','elbe-elster','dahme-spreewald','oder-spree','oberspreewald-lausitz'
];
function inRegionByText(v=''){const t=normalize(v);return REGION_WORDS.some(x=>t.includes(normalize(x)));}

async function fetchWithRetry(url,{headers={},json=false,attempts=3}={}){
  let last;
  for(let i=0;i<attempts;i++){
    try{
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000);
      const res=await fetch(url,{headers:{'User-Agent':USER_AGENT,'Accept-Language':'de-DE,de;q=0.9,en;q=0.6',...headers},signal:controller.signal,redirect:'follow'});clearTimeout(timer);
      if(!res.ok)throw new Error(`${res.status} ${res.statusText}`);
      return json?await res.json():await res.text();
    }catch(e){last=e;if(i<attempts-1)await sleep(800*(i+1));}
  }
  throw last;
}
function makeSource(name,url){return {name,url};}
function finalizeJob(j){
  const sources=uniq((j.sources||[]).map(s=>s?.url?`${s.name}|||${s.url}`:null)).map(x=>{const [name,url]=x.split('|||');return{name,url};});
  const title=clean(j.title), company=clean(j.company), location=clean(j.location), address=clean(j.address);
  const id=j.id||hash(`${normalize(title)}|${normalizeCompany(company)}|${normalize(location||address)}|${j.url||''}`);
  return {id,title,company,location,address,lat:num(j.lat),lon:num(j.lon),remote:Boolean(j.remote),employmentType:uniq(Array.isArray(j.employmentType)?j.employmentType.map(clean):[clean(j.employmentType)]),publishedAt:isoDate(j.publishedAt),validThrough:isoDate(j.validThrough),url:j.url||sources[0]?.url||null,source:j.source||sources[0]?.name||'Unbekannt',sources:sources.length?sources:[makeSource(j.source||'Unbekannt',j.url)],description:stripHtml(j.description).slice(0,6500),salary:clean(j.salary)||null,remoteFull:j.remoteFull===true?true:undefined,distanceKm:Number.isFinite(j.distanceKm)?j.distanceKm:undefined,homeofficePossible:j.homeofficePossible===true?true:undefined};
}

// ---------------------------------------------------------------------------
// Bundesagentur für Arbeit – Jobsuche-API v6
// Das Antwortschema hat sich geändert: die Treffer liegen in "ergebnisliste",
// nicht mehr in "stellenangebote". Deshalb kam bisher 0 zurück.
// ---------------------------------------------------------------------------
const BA_BASE='https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs';
const BA_KEY='jobboerse-jobsuche';
const BA_HOME='13589 Berlin';        // Suchmittelpunkt = Marwitzer Str. 67
const BA_RADIUS='15';                // km rund um den Suchmittelpunkt
const BA_DAYS='28';
// Gezielte Suchbegriffe: liefern deutlich mehr passende Bürostellen im Umkreis,
// als die reine Umkreissuche in den ersten Seiten hergibt.
const BA_TERMS=[
  'Sachbearbeiter','Bürokauffrau','Kaufmännischer Mitarbeiter','Assistenz','Sekretariat',
  'Empfang','Kundenservice','Kundenbetreuer','Call Center','Buchhaltung','Lohnbuchhaltung',
  'Finanzbuchhalter','Steuerfachangestellte','Controlling','Personalsachbearbeiter',
  'Verwaltungsfachangestellte','Datenerfassung','Auftragssachbearbeitung','Vertriebsinnendienst',
  'Einkauf','Disponent','Immobilienverwaltung','Hausverwaltung','IT-Support','Backoffice',
  'Office Manager','Teamassistenz','Rezeption','Bürohilfe','Verwaltung'
];

function baEmploymentType(o){
  const out=[];
  if(o.arbeitszeitVollzeit)out.push('Vollzeit');
  if(o.arbeitszeitTeilzeitVormittag||o.arbeitszeitTeilzeitNachmittag||o.arbeitszeitTeilzeitAbend||o.arbeitszeitTeilzeitFlexibel)out.push('Teilzeit');
  if(o.istGeringfuegigeBeschaeftigung)out.push('Minijob');
  if(o.arbeitszeitSchichtNachtWochenende)out.push('Schicht/Nacht/Wochenende');
  if(o.homeofficemoeglich)out.push('Homeoffice möglich');
  return out;
}

function baMapJob(o,sourceName){
  const loc=(o.stellenlokationen&&o.stellenlokationen[0])||{};
  const adr=loc.adresse||{};
  const ref=o.referenznummer||o.refnr||o.hashId;
  const url=o.externeURL||o.externeUrl||(ref?`https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(ref)}`:'https://www.arbeitsagentur.de/jobsuche/');
  const job=finalizeJob({
    id:ref?`ba-${hash(ref)}`:null,
    title:o.stellenangebotsTitel||o.titel||o.beruf||o.hauptberuf,
    company:o.firma||o.arbeitgeber||o.arbeitgeberName,
    location:clean([adr.plz,adr.ort].filter(Boolean).join(' ')),
    address:clean([adr.strasse,adr.plz,adr.ort].filter(Boolean).join(', ')),
    lat:Number(loc.breite),
    lon:Number(loc.laenge),
    employmentType:baEmploymentType(o),
    publishedAt:o.datumErsteVeroeffentlichung||o.veroeffentlichungszeitraum?.von||o.aenderungsdatum,
    url,
    description:o.stellenangebotsBeschreibung||'',
    source:sourceName,
    sources:[makeSource(sourceName,url)],
    remote:Boolean(o.homeofficemoeglich)
  });
  // Zusatzfelder, die die späteren Filterschritte nutzen können.
  if(Number.isFinite(Number(o.entfernung)))job.distanceKm=Number(o.entfernung);
  job.homeofficePossible=Boolean(o.homeofficemoeglich);
  job.refnr=ref||null;
  return job;
}

async function baSearch(params,maxPages=3){
  const rows=[];
  for(let page=1;page<=maxPages;page++){
    const u=new URL(BA_BASE);
    Object.entries({angebotsart:'1',page:String(page),size:'100',pav:'false',...params}).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v));});
    let data;
    try{data=await fetchWithRetry(u,{json:true,headers:{'X-API-Key':BA_KEY}});}
    catch(e){console.warn(`[BA] ${u.searchParams.get('was')||'Umkreis'} Seite ${page}: ${e.message}`);break;}
    const list=data.ergebnisliste||data.stellenangebote||data.jobs||[];
    if(!list.length)break;
    rows.push(...list);
    if(list.length<100)break;
    await sleep(140);
  }
  return rows;
}

async function fetchArbeitsagentur(){
  const name='Bundesagentur für Arbeit';
  const seen=new Set();
  const jobs=[];
  const push=raw=>{
    const ref=raw.referenznummer||raw.refnr||raw.hashId;
    if(ref){if(seen.has(ref))return;seen.add(ref);}
    jobs.push(baMapJob(raw,name));
  };

  // 1) Breite Umkreissuche um die feste Adresse.
  for(const raw of await baSearch({wo:BA_HOME,umkreis:BA_RADIUS,veroeffentlichtseit:BA_DAYS},12))push(raw);

  // 2) Gezielte Bürosuchbegriffe im selben Umkreis.
  for(const was of BA_TERMS){
    for(const raw of await baSearch({was,wo:BA_HOME,umkreis:BA_RADIUS,veroeffentlichtseit:BA_DAYS},2))push(raw);
    await sleep(120);
  }

  console.log(`[${name}] Umkreis ${BA_RADIUS} km + ${BA_TERMS.length} Suchbegriffe -> ${jobs.length} Treffer`);
  return jobs;
}

async function fetchArbeitsagenturHomeoffice(){
  const name='Bundesagentur Homeoffice';
  const seen=new Set();
  const raws=[];
  for(const was of ['Sachbearbeiter','Kundenservice','Buchhaltung','Assistenz','Datenerfassung','Backoffice','IT-Support','Vertriebsinnendienst']){
    for(const raw of await baSearch({was,veroeffentlichtseit:'14'},2)){
      if(!raw.homeofficemoeglich)continue;
      const ref=raw.referenznummer||raw.refnr;
      if(ref&&seen.has(ref))continue;
      if(ref)seen.add(ref);
      raws.push(raw);
    }
    await sleep(120);
  }
  // Beschreibungen nachladen, damit "100 % Homeoffice" belegt werden kann.
  const limited=raws.slice(0,120);
  const jobs=[];
  for(const raw of limited){
    const ref=raw.referenznummer||raw.refnr;
    let desc='';
    if(ref){
      try{
        const enc=Buffer.from(String(ref),'utf8').toString('base64');
        const d=await fetchWithRetry(`https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails/${enc}`,{json:true,attempts:2,headers:{'X-API-Key':BA_KEY}});
        desc=stripHtml(d.stellenangebotsBeschreibung||'');
      }catch{}
      await sleep(90);
    }
    const job=baMapJob({...raw,stellenangebotsBeschreibung:desc},name);
    const t=`${job.title} ${desc}`.toLowerCase();
    const full=/(100\s?%\s?(remote|homeoffice|home-office)|vollst[aä]ndig remote|komplett remote|fully remote|reines homeoffice|ausschlie[sß]lich (remote|homeoffice)|remote first|ortsunabh[aä]ngig)/.test(t)&&!/hybrid|teilweise|gelegentlich|tage (pro|die) woche/.test(t);
    if(!full)continue;
    job.remote=true;
    job.remoteFull=true;
    jobs.push(job);
  }
  console.log(`[${name}] ${raws.length} Homeoffice-Kandidaten -> ${jobs.length} reine Remote-Stellen`);
  return jobs;
}

async function fetchArbeitnow(){
  const name='Arbeitnow';const jobs=[];
  for(let page=1;page<=20;page++){
    const u=new URL('https://www.arbeitnow.com/api/job-board-api');u.searchParams.set('page',String(page));
    let data;try{data=await fetchWithRetry(u,{json:true});}catch(e){console.warn(`[${name}] page ${page}: ${e.message}`);break;}
    const rows=data.data||[];if(!rows.length)break;
    for(const o of rows){
      if(!inRegionByText(o.location||''))continue;
      jobs.push(finalizeJob({id:`arbeitnow-${o.slug||hash(o.url||o.title)}`,title:o.title,company:o.company_name,location:o.location,remote:o.remote,employmentType:o.job_types||[],publishedAt:o.created_at?new Date(Number(o.created_at)*1000):null,url:o.url,description:o.description,source:name,sources:[makeSource(name,o.url)]}));
    }
    if(!data.links?.next && page>5 && rows.length<10)break;
    await sleep(120);
  }
  return jobs;
}

function decodeEntities(s=''){
  return s.replace(/&quot;/g,'"').replace(/&#34;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#x2F;/gi,'/');
}
function extractLinks(html,baseUrl){
  const out=[];const re=/\bhref\s*=\s*["']([^"'#]+)["']/gi;let m;
  while((m=re.exec(html))){try{const u=new URL(decodeEntities(m[1]),baseUrl);if(['http:','https:'].includes(u.protocol))out.push(u.href.split('#')[0]);}catch{}}
  return uniq(out);
}
function flattenJsonLd(node,out=[]){
  if(Array.isArray(node)){for(const x of node)flattenJsonLd(x,out);return out;}
  if(!node||typeof node!=='object')return out;
  const type=node['@type']; if(type==='JobPosting'||(Array.isArray(type)&&type.includes('JobPosting')))out.push(node);
  if(node['@graph'])flattenJsonLd(node['@graph'],out); return out;
}
function extractJsonLdJobs(html){
  const jobs=[];const re=/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;
  while((m=re.exec(html))){const raw=m[1].trim();if(!raw)continue;for(const candidate of [raw,decodeEntities(raw)]){try{const obj=JSON.parse(candidate);flattenJsonLd(obj,jobs);break;}catch{}}}
  return jobs;
}
function addressFromLd(loc){
  const l=Array.isArray(loc)?loc[0]:loc;if(!l)return{};const a=l.address||l;const parts=[a.streetAddress,a.postalCode,a.addressLocality].filter(Boolean);const region=a.addressRegion;const geo=l.geo||{};
  return {location:clean([a.postalCode,a.addressLocality].filter(Boolean).join(' '))||clean(a.addressLocality||region||''),address:clean(parts.join(', ')),region:clean(region||''),lat:Number(geo.latitude),lon:Number(geo.longitude)};
}
function salaryFromLd(baseSalary){
  if(!baseSalary)return null;if(typeof baseSalary==='string'||typeof baseSalary==='number')return clean(baseSalary);const v=baseSalary.value||baseSalary;const val=v.value??(v.minValue&&v.maxValue?`${v.minValue}–${v.maxValue}`:v.minValue||v.maxValue);return val?clean(`${val}${baseSalary.currency?` ${baseSalary.currency}`:''}${v.unitText?` / ${v.unitText}`:''}`):null;
}
function ldToJob(ld,pageUrl,source){
  const a=addressFromLd(ld.jobLocation);const company=ld.hiringOrganization?.name||ld.hiringOrganization||ld.organization?.name;const types=Array.isArray(ld.employmentType)?ld.employmentType:[ld.employmentType].filter(Boolean);
  return finalizeJob({title:ld.title||ld.name,company,location:a.location||a.region,address:a.address,lat:a.lat,lon:a.lon,remote:String(ld.jobLocationType||'').toUpperCase().includes('TELECOMMUTE')||Boolean(ld.applicantLocationRequirements&& !ld.jobLocation),employmentType:types,publishedAt:ld.datePosted,validThrough:ld.validThrough,url:ld.url||pageUrl,description:ld.description,salary:salaryFromLd(ld.baseSalary),source,sources:[makeSource(source,ld.url||pageUrl)]});
}

const REGIONAL_SOURCES=[
  {name:'Tagesspiegel Jobs',origin:'https://jobs.tagesspiegel.de',lists:['https://jobs.tagesspiegel.de/','https://jobs.tagesspiegel.de/stellenangebote/jobs-in-berlin'],match:u=>u.hostname==='jobs.tagesspiegel.de'&&/\/stellenangebote\//i.test(u.pathname)&&(/\.html$/i.test(u.pathname)||/job/i.test(u.pathname)),max:55},
  {name:'Berliner Morgenpost Jobs',origin:'https://jobs.morgenpost.de',lists:['https://jobs.morgenpost.de/jobs','https://jobs.morgenpost.de/jobs?page=2','https://jobs.morgenpost.de/jobs?page=3'],match:u=>u.hostname==='jobs.morgenpost.de'&&/^\/job\//i.test(u.pathname),max:60},
  {name:'MAZ Job',origin:'https://www.maz-job.de',lists:['https://www.maz-job.de/','https://www.maz-job.de/jobs','https://www.maz-job.de/jobs?page=2'],match:u=>u.hostname.endsWith('maz-job.de')&&/^\/job\//i.test(u.pathname),max:60},
  {name:'bluum Brandenburg',origin:'https://bb.bluum.de',lists:['https://bb.bluum.de/jobs','https://bb.bluum.de/jobs?page=2','https://bb.bluum.de/jobs?page=3'],match:u=>u.hostname==='bb.bluum.de'&&/^\/job\//i.test(u.pathname),max:60},
  {name:'Berliner Zeitung Jobmarkt',origin:'https://www.berliner-jobmarkt.de',lists:['https://www.berliner-jobmarkt.de/'],match:u=>u.hostname.endsWith('berliner-jobmarkt.de')&&(/job|stellenangebot|stellenanzeige/i.test(u.pathname)),max:50}
];
async function fetchRegionalSource(cfg){
  const candidate=[];const jobs=[];
  for(const list of cfg.lists){
    try{const html=await fetchWithRetry(list);for(const ld of extractJsonLdJobs(html))jobs.push(ldToJob(ld,list,cfg.name));for(const href of extractLinks(html,list)){try{const u=new URL(href);if(cfg.match(u))candidate.push(u.href);}catch{}}}catch(e){console.warn(`[${cfg.name}] list ${list}: ${e.message}`);} await sleep(180);
  }
  const links=uniq(candidate).slice(0,cfg.max);
  for(let i=0;i<links.length;i+=4){
    const batch=links.slice(i,i+4);const rows=await Promise.all(batch.map(async href=>{try{const html=await fetchWithRetry(href,{attempts:2});return extractJsonLdJobs(html).map(ld=>ldToJob(ld,href,cfg.name));}catch(e){return[];}}));jobs.push(...rows.flat());await sleep(240);
  }
  return jobs.filter(j=>inRegionByText(`${j.location} ${j.address}`)||(inRegionByCoords(j.lat,j.lon))||cfg.name==='MAZ Job'||cfg.name==='bluum Brandenburg');
}

async function fetchAdzuna(){
  const appId=process.env.ADZUNA_APP_ID, appKey=process.env.ADZUNA_APP_KEY;if(!appId||!appKey)return[];
  const name='Adzuna';const jobs=[];
  for(let page=1;page<=5;page++){
    const u=new URL(`https://api.adzuna.com/v1/api/jobs/de/search/${page}`);Object.entries({app_id:appId,app_key:appKey,results_per_page:'50',where:'Berlin',distance:'100',sort_by:'date'}).forEach(([k,v])=>u.searchParams.set(k,v));
    let data;try{data=await fetchWithRetry(u,{json:true});}catch(e){console.warn(`[${name}] ${e.message}`);break;}
    for(const o of data.results||[]){jobs.push(finalizeJob({id:`adzuna-${o.id}`,title:o.title,company:o.company?.display_name,location:o.location?.display_name,lat:Number(o.latitude),lon:Number(o.longitude),employmentType:[o.contract_time,o.contract_type].filter(Boolean),publishedAt:o.created,url:o.redirect_url,description:o.description,salary:o.salary_min||o.salary_max?`${o.salary_min||''}${o.salary_min&&o.salary_max?'–':''}${o.salary_max||''}`:null,source:name,sources:[makeSource(name,o.redirect_url)]}));}
    if((data.results||[]).length<50)break;await sleep(180);
  }return jobs;
}

let geocodeCache={};
async function loadCache(){try{geocodeCache=JSON.parse(await fs.readFile(CACHE_PATH,'utf8'));}catch{geocodeCache={};}}
async function geocode(query){
  const key=normalize(query);if(!key)return null;if(Object.hasOwn(geocodeCache,key))return geocodeCache[key];if(geocodeCount>=GEOCODE_LIMIT)return null;
  geocodeCount++;const u=new URL('https://nominatim.openstreetmap.org/search');Object.entries({format:'jsonv2',limit:'1',countrycodes:'de',q:query}).forEach(([k,v])=>u.searchParams.set(k,v));
  try{await sleep(1100);const data=await fetchWithRetry(u,{json:true,attempts:2});const hit=data[0]?{lat:Number(data[0].lat),lon:Number(data[0].lon),display_name:data[0].display_name}:null;geocodeCache[key]=hit;return hit;}catch(e){console.warn(`[geocode] ${query}: ${e.message}`);geocodeCache[key]=null;return null;}
}
async function addCoordinates(jobs){
  for(const job of jobs){if(inRegionByCoords(job.lat,job.lon))continue;const q=job.address||job.location;if(!q||/deutschland|bundesweit|remote/i.test(q))continue;const g=await geocode(`${q}, Deutschland`);if(g&&inRegionByCoords(g.lat,g.lon)){job.lat=g.lat;job.lon=g.lon;}}
}

function dedupeJobs(rows){
  const result=[];const buckets=new Map();let merged=0;
  const sorted=[...rows].sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0));
  for(const job of sorted){
    const company=normalizeCompany(job.company),loc=normalize(job.location||job.address).replace(/\b\d{5}\b/g,'').trim();const bucketKey=`${company.slice(0,28)}|${loc.slice(0,24)}`;const candidates=buckets.get(bucketKey)||[];
    let target=candidates.find(x=>normalize(x.title)===normalize(job.title)||similarity(x.title,job.title)>=.78);
    if(!target&&company){target=result.find(x=>normalizeCompany(x.company)===company&&similarity(x.title,job.title)>=.9&&similarity(x.location,job.location)>=.55);}
    if(target){merged++;target.sources=uniq([...(target.sources||[]),...(job.sources||[])].map(s=>`${s.name}|||${s.url}`)).map(x=>{const [name,url]=x.split('|||');return{name,url};});if(!target.lat&&job.lat){target.lat=job.lat;target.lon=job.lon;}if((job.description||'').length>(target.description||'').length)target.description=job.description;if(!target.salary&&job.salary)target.salary=job.salary;if(job.remote)target.remote=true;target.employmentType=uniq([...(target.employmentType||[]),...(job.employmentType||[])]);continue;}
    result.push(job);candidates.push(job);buckets.set(bucketKey,candidates);
  }
  return {jobs:result,merged};
}

async function main(){
  await fs.mkdir(path.dirname(OUT),{recursive:true});await fs.mkdir(path.dirname(CACHE_PATH),{recursive:true});await loadCache();
  const sourceStats=[];const all=[];
  async function run(name,fn){const start=Date.now();try{const rows=await fn();all.push(...rows);sourceStats.push({name,count:rows.length,status:'ok',ms:Date.now()-start});console.log(`[${name}] ${rows.length}`);}catch(e){sourceStats.push({name,count:0,status:'error',error:e.message,ms:Date.now()-start});console.error(`[${name}]`,e);}}
  await run('Bundesagentur für Arbeit',fetchArbeitsagentur);
  await run('Bundesagentur Homeoffice',fetchArbeitsagenturHomeoffice);
  await run('Arbeitnow',fetchArbeitnow);
  for(const cfg of REGIONAL_SOURCES)await run(cfg.name,()=>fetchRegionalSource(cfg));
  await run('Adzuna',fetchAdzuna);

  const pre=all.map(finalizeJob).filter(j=>j.title&&j.url).filter(j=>!j.publishedAt||daysOld(j.publishedAt)<=MAX_AGE_DAYS);
  const excludedTraining=pre.filter(isTraining).length;let kept=pre.filter(j=>!isTraining(j));
  // BA and explicitly regional portals are trusted by their geographic search; broad aggregators need location evidence.
  kept=kept.filter(j=>['Bundesagentur für Arbeit','Bundesagentur Homeoffice','Tagesspiegel Jobs','Berliner Morgenpost Jobs','MAZ Job','bluum Brandenburg','Berliner Zeitung Jobmarkt'].includes(j.source)||inRegionByText(`${j.location} ${j.address}`)||inRegionByCoords(j.lat,j.lon));
  await addCoordinates(kept);
  const {jobs,merged}=dedupeJobs(kept);
  jobs.sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0));
  const payload={meta:{generatedAt:NOW.toISOString(),total:jobs.length,mapped:jobs.filter(j=>inRegionByCoords(j.lat,j.lon)).length,deduplicated:merged,excludedTraining,sources:sourceStats,geocodedThisRun:geocodeCount,region:'Berlin & Brandenburg',trainingOffers:false},jobs};
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n','utf8');await fs.writeFile(CACHE_PATH,JSON.stringify(geocodeCache,null,2)+'\n','utf8');
  console.log(`Done: ${jobs.length} jobs, ${payload.meta.mapped} mapped, ${merged} duplicates merged, ${excludedTraining} training offers removed.`);
}
main().catch(err=>{console.error(err);process.exitCode=1;});
