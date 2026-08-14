import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT='public/data/jobs.json';
const CACHE='data/geocode-cache.json';
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß%]+/g,' ').replace(/\s+/g,' ').trim();
const strip=v=>clean(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'"));
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);

function excluded(title='',extra=''){
  const t=norm(`${title} ${extra}`);
  return /(ausbildung|ausbildungsplatz|auszubild|azubi|lehrstelle|duales studium|dual studium|dualstudent|berufsausbildung|werkstudent|werkstudentin|werkstudierende|working student|studentische hilfskraft|student assistant|studentenjob|student job|praktikum|praktikant|praktikantin|praktikumsplatz|internship|\bintern\b)/i.test(t);
}
function titleOf(html){
  const h=html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const og=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const tt=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return strip(h||og||tt||'').replace(/\s*[|–-]\s*(IKEA|Kaufland|Vivantes|BVG|BMW.*|Siemens.*|Alstom.*|Johannesstift.*).*$/i,'').trim();
}
function links(html,base){
  const out=[]; const re=/\bhref\s*=\s*["']([^"'#]+)["']/gi; let m;
  while((m=re.exec(html))){try{const u=new URL(m[1].replace(/&amp;/g,'&'),base);if(/^https?:$/.test(u.protocol))out.push(u.href.split('#')[0]);}catch{}}
  return [...new Set(out)];
}
async function get(url,tries=2){
  let last;
  for(let i=0;i<tries;i++){
    try{const c=new AbortController();const t=setTimeout(()=>c.abort(),22000);const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9'},signal:c.signal,redirect:'follow'});clearTimeout(t);if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();}
    catch(e){last=e;if(i<tries-1)await sleep(600*(i+1));}
  }
  throw last;
}
let cache={};
async function geocode(q){
  const key=`direct:${norm(q)}`;
  if(Object.hasOwn(cache,key))return cache[key];
  try{await sleep(1100);const u=new URL('https://nominatim.openstreetmap.org/search');u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',q);const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'de-DE'}});if(!r.ok)throw new Error(String(r.status));const d=await r.json();cache[key]=d[0]?{lat:+d[0].lat,lon:+d[0].lon,display_name:d[0].display_name}:null;return cache[key];}catch{cache[key]=null;return null;}
}
function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group)\b/g,' ').replace(/\s+/g,' ').trim();}
function same(a,b){return norm(a.title)===norm(b.title)&&companyNorm(a.company)&&companyNorm(a.company)===companyNorm(b.company);}
function merge(base,j){const hit=base.find(x=>same(x,j));if(!hit){base.push(j);return'added';}hit.sources=Array.isArray(hit.sources)?hit.sources:[];if(!hit.sources.some(s=>s.url===j.url))hit.sources.push({name:j.source,url:j.url});if(!hit.lat&&j.lat){hit.lat=j.lat;hit.lon=j.lon;}if((j.description||'').length>(hit.description||'').length)hit.description=j.description;return'merged';}

const SOURCES=[
  {
    name:'Johannesstift Diakonie direkt',company:'Johannesstift Diakonie',
    lists:['https://www.johannesstift-diakonie.de/karriere-bildung/stellenangebote-bewerbung/stellenangebot/online-bewerbung'],
    match:u=>u.hostname.endsWith('johannesstift-diakonie.de')&&u.pathname.includes('/stellenangebot/')&&!u.pathname.endsWith('/online-bewerbung'),
    local:text=>/spandau|siemensstadt/i.test(text),
    geo:text=>/siemensstadt/i.test(text)?'Siemensstadt, Berlin':'Evangelisches Johannesstift, Berlin-Spandau',
    location:text=>/siemensstadt/i.test(text)?'Berlin-Siemensstadt':'Berlin-Spandau',max:120
  },
  {
    name:'Vivantes direkt',company:'Vivantes',
    lists:['https://karriere.vivantes.de/arbeiten-bei-vivantes/unser-netzwerk/klinikum-spandau/page/1/','https://karriere.vivantes.de/arbeiten-bei-vivantes/unser-netzwerk/klinikum-spandau/page/2/','https://karriere.vivantes.de/arbeiten-bei-vivantes/unser-netzwerk/klinikum-spandau/page/3/'],
    match:u=>u.hostname==='karriere.vivantes.de'&&u.pathname.includes('/stellenangebote/detail/'),
    local:text=>/spandau/i.test(text),geo:()=> 'Vivantes Klinikum Spandau, Berlin',location:()=> 'Berlin-Spandau',max:100
  },
  {
    name:'IKEA Spandau direkt',company:'IKEA',
    lists:['https://jobs.ikea.com/de/l%C3%A4nderauswahl/berlin-jobs/22908/2921044-2950157/3/1','https://jobs.ikea.com/de/besch%C3%A4ftigung/spandau-berlin-deutschland-verkauf-jobs/22908/59697/2921044-2950157-6547383-6547539-7290252/4'],
    match:u=>u.hostname==='jobs.ikea.com'&&(/stellenbeschreibung|\/job\//i.test(u.pathname)),
    local:text=>/spandau/i.test(text),geo:()=> 'IKEA Berlin-Spandau, Berlin',location:()=> 'Berlin-Spandau',max:60
  },
  {
    name:'Kaufland direkt',company:'Kaufland',
    lists:['https://jobs.kaufland.com/Deutschland/?locale=de_DE&locationsearch=Berlin&q=','https://jobs.kaufland.com/Deutschland/go/Vertrieb-unsere-Stellen-in-Deutschland/2751001/'],
    match:u=>u.hostname==='jobs.kaufland.com'&&/\/job\//i.test(u.pathname),
    local:text=>/spandau|13581|13583|13585|13587|13589|13591|13593|13595|13597|13599|13629/i.test(text),
    geo:text=>{const p=text.match(/\b(1358[13579]|1359[13579]|13629)\b/)?.[1];return p?`${p} Berlin`:'Berlin-Spandau';},location:()=> 'Berlin-Spandau',max:80
  },
  {
    name:'BVG direkt',company:'BVG',
    lists:['https://karriere.bvg.de/jobs'],
    match:u=>u.hostname==='karriere.bvg.de'&&u.pathname.includes('/jobs/detail/'),
    local:text=>/spandau|rohrdamm|siemensstadt/i.test(text),geo:()=> 'BVG Betriebshof Spandau, Berlin',location:()=> 'Berlin-Spandau',max:80
  },
  {
    name:'BMW Werk Berlin direkt',company:'BMW Group',
    lists:['https://www.bmwgroup.jobs/de/de/standorte/werke-in-deutschland/werk-berlin.html','https://www.bmwgroup.jobs/de/de/jobs.html'],
    match:u=>u.hostname.endsWith('bmwgroup.jobs')&&(/job|stellen/i.test(u.pathname))&&!/schueler|ausbildung/i.test(u.pathname),
    local:text=>/berlin/i.test(text),geo:()=> 'BMW Motorrad Werk Berlin, Berlin',location:()=> 'Berlin-Spandau',max:60
  },
  {
    name:'Siemensstadt direkt',company:'Siemens',
    lists:['https://jobs.siemens.com/de_DE/externaljobs/SearchJobs/?folderId=498392&folderOffset=0&folderRecordsPerPage=100'],
    match:u=>u.hostname==='jobs.siemens.com'&&/\/JobDetail\//i.test(u.pathname),
    local:text=>/siemensstadt|mittelspannungswerk|schaltwerk berlin|nonnendammallee|rohrdamm/i.test(text),geo:()=> 'Siemensstadt, Berlin',location:()=> 'Berlin-Siemensstadt',max:100
  },
  {
    name:'Alstom Hennigsdorf direkt',company:'Alstom',
    lists:['https://www.alstom.com/de/karriere-hennigsdorf'],
    match:u=>(u.hostname==='jobs.alstom.com'||u.hostname.endsWith('alstom.com'))&&/job|karriere|career/i.test(u.pathname),
    local:text=>/hennigsdorf/i.test(text),geo:()=> 'Alstom Hennigsdorf, Hennigsdorf',location:()=> 'Hennigsdorf',max:80
  }
];

async function crawl(cfg){
  let urls=[];
  for(const list of cfg.lists){try{const h=await get(list);urls.push(...links(h,list).filter(x=>{try{return cfg.match(new URL(x));}catch{return false;}}));}catch(e){console.warn(`[${cfg.name}] Liste: ${e.message}`);}}
  urls=[...new Set(urls)].slice(0,cfg.max||60);
  const jobs=[];
  for(let i=0;i<urls.length;i+=5){
    const batch=await Promise.all(urls.slice(i,i+5).map(async url=>{try{const html=await get(url);const text=strip(html);const title=titleOf(html);if(!title||excluded(title,text)||!cfg.local(text))return null;const g=await geocode(cfg.geo(text));return{id:`direct-${hash(url)}`,title,company:cfg.company,location:cfg.location(text),address:g?.display_name||'',lat:g?.lat??null,lon:g?.lon??null,remote:false,remoteFull:false,employmentType:[],publishedAt:null,validThrough:null,url,source:cfg.name,sources:[{name:cfg.name,url}],description:text.slice(0,6500),salary:null};}catch{return null;}}));jobs.push(...batch.filter(Boolean));await sleep(120);
  }
  console.log(`[${cfg.name}] ${jobs.length}`);return jobs;
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}
  payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  let added=0,merged=0;
  for(const cfg of SOURCES){const jobs=await crawl(cfg);for(const j of jobs){const r=merge(payload.jobs,j);if(r==='added')added++;else merged++;}const s=payload.meta.sources.find(x=>x.name===cfg.name);if(s){s.count=jobs.length;s.status='ok';}else payload.meta.sources.push({name:cfg.name,count:jobs.length,status:'ok'});}
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;payload.meta.directEmployerSources=SOURCES.length;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');
  console.log(`Direkte Arbeitgeber: ${added} neue, ${merged} zusammengeführt.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
