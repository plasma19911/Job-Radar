import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT='public/data/jobs.json';
const CACHE='data/geocode-cache.json';
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß%]+/g,' ').replace(/\s+/g,' ').trim();
const strip=v=>clean(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&auml;/gi,'ä').replace(/&ouml;/gi,'ö').replace(/&uuml;/gi,'ü').replace(/&szlig;/gi,'ß'));
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);

function excluded(title='',extra=''){
  const t=norm(`${title} ${extra}`);
  return /(ausbildung|ausbildungsplatz|auszubild|azubi|lehrstelle|duales studium|dual studium|dualstudent|berufsausbildung|werkstudent|werkstudentin|werkstudierende|working student|studentische hilfskraft|student assistant|studentenjob|student job|praktikum|praktikant|praktikantin|praktikumsplatz|internship|\bintern\b|schülerpraktikum|schuelerpraktikum)/i.test(t);
}
function titleOf(html){
  const h=html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const og=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const tt=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return strip(h||og||tt||'').replace(/\s*[|–-]\s*(Stadt Hennigsdorf|Stadtwerke Hennigsdorf|S-Servicepartner|Autobahn|BWS|Blindenwohnstätten|ETL|Octapharma|Klüh).*$/i,'').trim();
}
function links(html,base){
  const out=[]; const re=/\bhref\s*=\s*["']([^"'#]+)["']/gi; let m;
  while((m=re.exec(html))){try{const u=new URL(m[1].replace(/&amp;/g,'&'),base);if(/^https?:$/.test(u.protocol))out.push(u.href.split('#')[0]);}catch{}}
  return [...new Set(out)];
}
async function get(url,tries=2){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const c=new AbortController(); const timer=setTimeout(()=>c.abort(),22000);
      const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9'},signal:c.signal,redirect:'follow'});
      clearTimeout(timer); if(!r.ok)throw new Error(`${r.status} ${r.statusText}`); return await r.text();
    }catch(e){last=e;if(i<tries-1)await sleep(700*(i+1));}
  }
  throw last;
}
let cache={};
async function geocode(q){
  const key=`more-direct:${norm(q)}`;
  if(Object.hasOwn(cache,key))return cache[key];
  try{
    await sleep(1100);
    const u=new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',q);
    const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'de-DE'}});if(!r.ok)throw new Error(String(r.status));
    const d=await r.json();cache[key]=d[0]?{lat:+d[0].lat,lon:+d[0].lon,display_name:d[0].display_name}:null;return cache[key];
  }catch{cache[key]=null;return null;}
}
function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland)\b/g,' ').replace(/\s+/g,' ').trim();}
function same(a,b){
  const ac=companyNorm(a.company),bc=companyNorm(b.company);
  if(!ac||!bc||ac!==bc)return false;
  const at=norm(a.title),bt=norm(b.title);
  return at===bt || (at.length>12&&bt.length>12&&(at.includes(bt)||bt.includes(at)));
}
function merge(base,j){
  const hit=base.find(x=>same(x,j));
  if(!hit){base.push(j);return'added';}
  hit.sources=Array.isArray(hit.sources)?hit.sources:[];
  if(!hit.sources.some(s=>s.url===j.url))hit.sources.push({name:j.source,url:j.url});
  if(!hit.lat&&j.lat){hit.lat=j.lat;hit.lon=j.lon;hit.address=j.address;}
  if((j.description||'').length>(hit.description||'').length)hit.description=j.description;
  return'merged';
}

const SOURCES=[
  {
    name:'Stadt Hennigsdorf direkt',company:'Stadt Hennigsdorf',
    lists:['https://www.hennigsdorf.de/Rathaus/Verwaltung/','https://www.hennigsdorf.de/Startseite/Stellenangebote.php?FID=3590.1296.1&ModID=6&NavID=2713.1&object=tx%2C3590.3.1'],
    match:u=>u.hostname.endsWith('hennigsdorf.de')&&/stellenangebot/i.test(decodeURIComponent(u.pathname+u.search)),
    local:()=>true,geo:()=> 'Rathausplatz 1, 16761 Hennigsdorf',location:()=> 'Hennigsdorf',max:80
  },
  {
    name:'Stadtwerke Hennigsdorf direkt',company:'Stadtwerke Hennigsdorf',
    lists:['https://www.stadtwerke-hennigsdorf.de/karriere/','https://www.stadtwerke-hennigsdorf.de/category/jobs/'],
    match:u=>u.hostname.endsWith('stadtwerke-hennigsdorf.de')&&!/\/karriere\/?$|\/category\/jobs\/?$/i.test(u.pathname)&&/(referent|assistenz|sachbear|vertrieb|buchhalt|controll|personal|job|manager)/i.test(u.pathname),
    local:()=>true,geo:()=> 'Rathenaustraße 4, 16761 Hennigsdorf',location:()=> 'Hennigsdorf',max:60
  },
  {
    name:'S-Servicepartner direkt',company:'S-Servicepartner Deutschland',
    lists:['https://jobs.guidecom.de/jobportal/s-servicepartner/viewAusschreibungen.html'],
    match:u=>u.hostname==='jobs.guidecom.de'&&/\/s-servicepartner\/viewAusschreibung\//i.test(u.pathname),
    local:text=>/(^|\W)Berlin(\W|$)/i.test(text),geo:()=> 'Am Borsigturm 100, 13507 Berlin',location:()=> 'Berlin-Tegel',max:80
  },
  {
    name:'Autobahn Hennigsdorf direkt',company:'Die Autobahn GmbH des Bundes',
    lists:['https://jobs.autobahn.de/warum-autobahn/karriere-bei-der-autobahn','https://karriere.autobahn.de/go/Verwaltung/9088355/'],
    match:u=>(u.hostname.endsWith('autobahn.de'))&&(/\/karriere\/job\//i.test(u.pathname)||/\/job\/Hennigsdorf-/i.test(u.pathname)),
    local:text=>/hennigsdorf|16761/i.test(text),geo:()=> 'Hennigsdorf, Brandenburg',location:()=> 'Hennigsdorf',max:100
  },
  {
    name:'BWS Blindenwohnstätten direkt',company:'BWS Blindenwohnstätten',
    lists:['https://www.blindenwohnstaetten.de/stellenangebote.html'],
    match:u=>(u.hostname==='app.connectoor.de'||u.hostname.endsWith('blindenwohnstaetten.de'))&&(/job|stelle|career|agreement|bewerb/i.test(u.pathname+u.search)),
    local:text=>/spandau|13587|niederneuendorfer/i.test(text),geo:()=> 'Niederneuendorfer Allee 6-9, 13587 Berlin',location:()=> 'Berlin-Spandau',max:60
  },
  {
    name:'ETL Hennigsdorf direkt',company:'Schulz Hansen & Kollegen',
    lists:['https://kanzlei.etl.de/schulz-kollegen-hennigsdorf/stellenangebote'],
    match:u=>(u.hostname==='karriere.etl.de'&&/\/stellenangebot\//i.test(u.pathname))||(u.hostname==='kanzlei.etl.de'&&/stellenangebot/i.test(u.pathname)),
    local:text=>/hennigsdorf|16761|fontanesiedlung/i.test(text),geo:()=> 'Fontanesiedlung 13, 16761 Hennigsdorf',location:()=> 'Hennigsdorf',max:40
  },
  {
    name:'Octapharma Plasma Spandau direkt',company:'Octapharma Plasma',
    lists:['https://www.octapharmaplasma.de/jobs/'],
    match:u=>u.hostname.endsWith('octapharmaplasma.de')&&/\/jobs\//i.test(u.pathname)&&u.pathname!=='/jobs/',
    local:text=>/spandau|13587/i.test(text),geo:()=> 'Octapharma Plasma Berlin-Spandau, Berlin',location:()=> 'Berlin-Spandau',max:80
  },
  {
    name:'Klüh Borsigturm direkt',company:'Klüh',
    lists:['https://jobs.klueh.de/jobs-finden'],
    match:u=>u.hostname==='jobs.klueh.de'&&/\/jobs-finden\/details\/job\//i.test(u.pathname),
    local:text=>/am borsigturm|13507/i.test(text),geo:()=> 'Am Borsigturm 100, 13507 Berlin',location:()=> 'Berlin-Tegel',max:100
  }
];

async function crawl(cfg){
  let urls=[];
  for(const list of cfg.lists){
    try{
      const h=await get(list);
      urls.push(...links(h,list).filter(x=>{try{return cfg.match(new URL(x));}catch{return false;}}));
    }catch(e){console.warn(`[${cfg.name}] Liste: ${e.message}`);}
  }
  urls=[...new Set(urls)].slice(0,cfg.max||60);
  const jobs=[];
  for(let i=0;i<urls.length;i+=5){
    const batch=await Promise.all(urls.slice(i,i+5).map(async url=>{
      try{
        const html=await get(url);const text=strip(html);const title=titleOf(html);
        if(!title||title.length<4||excluded(title,text)||!cfg.local(text))return null;
        const g=await geocode(cfg.geo(text));
        return {id:`more-direct-${hash(url)}`,title,company:cfg.company,location:cfg.location(text),address:g?.display_name||cfg.geo(text),lat:g?.lat??null,lon:g?.lon??null,remote:false,remoteFull:false,employmentType:[],publishedAt:null,validThrough:null,url,source:cfg.name,sources:[{name:cfg.name,url}],description:text.slice(0,6500),salary:null};
      }catch{return null;}
    }));
    jobs.push(...batch.filter(Boolean));await sleep(140);
  }
  console.log(`[${cfg.name}] ${jobs.length}`);return jobs;
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));
  try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}
  payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  let added=0,merged=0;
  for(const cfg of SOURCES){
    const jobs=await crawl(cfg);
    for(const j of jobs){const r=merge(payload.jobs,j);if(r==='added')added++;else merged++;}
    const s=payload.meta.sources.find(x=>x.name===cfg.name);
    if(s){s.count=jobs.length;s.status='ok';}else payload.meta.sources.push({name:cfg.name,count:jobs.length,status:'ok'});
  }
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;
  payload.meta.directEmployerSources=(payload.meta.directEmployerSources||0)+SOURCES.length;
  payload.meta.expandedLocalEmployerSearch=true;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');
  await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');
  console.log(`Mehr lokale Arbeitgeber: ${added} neue, ${merged} zusammengeführt.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
