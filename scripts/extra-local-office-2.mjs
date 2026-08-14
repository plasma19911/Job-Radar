import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT='public/data/jobs.json';
const CACHE='data/geocode-cache.json';
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const strip=v=>clean(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'"));
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß]+/g,' ').trim();
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);

const JOBS=[
  {
    source:'Wolfgang Mehner Berlin direkt',
    company:'Wolfgang Mehner GmbH',
    title:'Industriekaufmann:frau - (m/w/d) - Kalkulation / Verkauf',
    key:'industriekaufmann',
    location:'Berlin-Tegel',
    address:'Am Borsigturm 70, 13507 Berlin',
    url:'https://www.mehner-karriere.de/',
    employmentType:['Vollzeit'],
    description:'Vertriebsinnendienst und kaufmännische Auftragsabwicklung: Angebote erstellen, kalkulieren und nachverfolgen, Kundenaufträge bearbeiten, Kunden und Lieferanten abstimmen sowie Kunden-, Artikel- und Auftragsdaten im Warenwirtschaftssystem pflegen. Sicherer Umgang mit ERP-Systemen und MS Office.'
  },
  {
    source:'DIE DRAUSSENWERBER Spandau direkt',
    company:'DIE DRAUSSENWERBER GmbH',
    title:'Kaufmännischer Mitarbeiter (m/w/d) Sales Backoffice',
    key:'sales backoffice',
    location:'Berlin-Spandau',
    address:'An der Spreeschanze 6, 13599 Berlin',
    url:'https://draussenwerber.softgarden.io/job/65377241?l=de',
    employmentType:['Vollzeit'],
    description:'Kaufmännisches Sales-Backoffice mit Auftragsabwicklung, Angebotserstellung, Auftragsbestätigungen und Rechnungen, Kunden- und Agenturanfragen, administrativer Disposition, Belegfotomanagement, Datenpflege und Zusammenarbeit mit Frontoffice und Buchhaltung. MS Office und Excel.'
  },
  {
    source:'IB Walther Spandau direkt',
    company:'Ingenieurbüro Walther GmbH',
    title:'Sachbearbeiter Koordination Service & Wartung (m/w/d)',
    key:'sachbearbeiter koordination service',
    location:'Berlin-Spandau',
    address:'Gartenfelder Str. 29-37, 13599 Berlin',
    url:'https://de.indeed.com/viewjob?jk=a1560bab2ebdd448',
    employmentType:['Vollzeit'],
    description:'Büro- und Koordinationsstelle im Servicebereich: Service- und Wartungseinsätze planen und koordinieren, Abläufe organisieren, Kundenkommunikation, Dokumentation sowie Vorbereitung von Wartung, Reparatur und Abrechnung. Sicherer Umgang mit Outlook, Excel und Word; Homeoffice nach Abstimmung möglich.'
  }
];

async function fetchText(url){
  const c=new AbortController(); const timer=setTimeout(()=>c.abort(),22000);
  try{
    const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9'},redirect:'follow',signal:c.signal});
    if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
    return strip(await r.text());
  } finally { clearTimeout(timer); }
}

let cache={};
async function geocode(q){
  const key=`extra-office-2:${norm(q)}`;
  if(Object.hasOwn(cache,key))return cache[key];
  try{
    await sleep(1100);
    const u=new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',q);
    const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'de-DE'}});const d=r.ok?await r.json():[];
    cache[key]=d[0]?{lat:+d[0].lat,lon:+d[0].lon,display_name:d[0].display_name}:null;
  }catch{cache[key]=null;}
  return cache[key];
}

function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland|ingenieurburo)\b/g,' ').replace(/\s+/g,' ').trim();}
function same(a,b){
  const ac=companyNorm(a.company),bc=companyNorm(b.company);if(!ac||!bc||ac!==bc)return false;
  const at=norm(a.title),bt=norm(b.title);return at===bt||(at.length>12&&bt.length>12&&(at.includes(bt)||bt.includes(at)));
}
function merge(base,j){
  const hit=base.find(x=>same(x,j));
  if(!hit){base.push(j);return'added';}
  hit.sources=Array.isArray(hit.sources)?hit.sources:[];
  if(!hit.sources.some(s=>s.url===j.url))hit.sources.push({name:j.source,url:j.url});
  if(!hit.lat&&j.lat){hit.lat=j.lat;hit.lon=j.lon;hit.address=j.address;}
  return'merged';
}
function makeJob(cfg,geo){return {
  id:`extra-local-office-2-${hash(`${cfg.company}|${cfg.title}|${cfg.url}`)}`,
  title:cfg.title,company:cfg.company,location:cfg.location,address:geo?.display_name||cfg.address,
  lat:geo?.lat??null,lon:geo?.lon??null,remote:false,remoteFull:false,
  employmentType:cfg.employmentType,publishedAt:null,validThrough:null,url:cfg.url,source:cfg.source,
  sources:[{name:cfg.source,url:cfg.url}],description:cfg.description,salary:null
};}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}
  let added=0,merged=0;const counts=new Map();
  for(const cfg of JOBS){
    try{
      const text=await fetchText(cfg.url);
      if(!norm(text).includes(norm(cfg.key))){console.warn(`[${cfg.source}] Stellenbegriff nicht gefunden: ${cfg.title}`);continue;}
      const geo=await geocode(cfg.address);
      const result=merge(payload.jobs,makeJob(cfg,geo));result==='added'?added++:merged++;
      counts.set(cfg.source,(counts.get(cfg.source)||0)+1);
    }catch(e){console.warn(`[${cfg.source}] ${e.message}`);}
  }
  payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  for(const cfg of JOBS){const count=counts.get(cfg.source)||0;const hit=payload.meta.sources.find(x=>x.name===cfg.source);if(hit){hit.count=count;hit.status='ok';}else payload.meta.sources.push({name:cfg.source,count,status:'ok'});}
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;payload.meta.extraLocalOffice2=true;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');
  console.log(`Weitere lokale Bürostellen: ${added} neue, ${merged} zusammengeführt.`);
}

main().catch(e=>{console.error(e);process.exit(1);});
