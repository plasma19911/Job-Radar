import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Zusätzliche große Jobportale für den erweiterten 15-km-Radar.
// Der finale Radius-, Büro/PC- und Ausschlussfilter läuft danach weiterhin zentral.
const OUT='public/data/jobs.json';
const CACHE='data/geocode-cache.json';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36 Job-Radar/1.0';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß]+/g,' ').replace(/\s+/g,' ').trim();
const strip=s=>clean(String(s??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&auml;/gi,'ä').replace(/&ouml;/gi,'ö').replace(/&uuml;/gi,'ü').replace(/&szlig;/gi,'ß'));
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);

const SOURCES=[
  {
    name:'Kimeta',
    lists:[
      'https://www.kimeta.de/stellenangebote-sachbearbeiter-in-berlin',
      'https://www.kimeta.de/stellenangebote-sachbearbeiter-b%C3%BCro-in-berlin',
      'https://www.kimeta.de/b%C3%BCrosachbearbeiter-stellenangebote-berlin',
      'https://www.kimeta.de/stellenangebote-assistenz-in-berlin',
      'https://www.kimeta.de/stellenangebote-kundenservice-in-berlin'
    ],
    match:u=>/kimeta\.de$/i.test(u.hostname)&&/\/stellenangebot\//i.test(u.pathname),
    max:45
  },
  {
    name:'HeyJobs',
    lists:[
      'https://www.heyjobs.co/de-de/jobs-in-Berlin-als-B%C3%BCro',
      'https://www.heyjobs.co/de-de/jobs-in-Berlin-als-B%C3%BCrokraft',
      'https://www.heyjobs.co/de-de/jobs-in-Berlin-als-B%C3%BCromanagement',
      'https://www.heyjobs.co/de-de/jobs-in-Berlin-als-Kundenservice'
    ],
    match:u=>/heyjobs\.co$/i.test(u.hostname)&&/\/de-de\/jobs\/[0-9a-f-]{20,}/i.test(u.pathname),
    max:45
  },
  {
    name:'JobMESH',
    lists:[
      'https://jobmesh.de/buero/jobs/berlin',
      'https://jobmesh.de/jobs/berlin',
      'https://jobmesh.de/quereinsteiger/teilzeit/jobs'
    ],
    match:u=>/jobmesh\.de$/i.test(u.hostname)&&!/^\/(?:jobs|buero|jobcenter|quereinsteiger)(?:\/|$)/i.test(u.pathname)&&/(job|stelle|angebot|arbeit)/i.test(u.pathname),
    max:35
  }
];

let cache={};
async function get(url,tries=2){
  let last;
  for(let i=0;i<tries;i++){
    const c=new AbortController();const timer=setTimeout(()=>c.abort(),18000);
    try{
      const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9,en;q=0.4','Accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:c.signal});
      if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
      return await r.text();
    }catch(e){last=e;if(i<tries-1)await sleep(500*(i+1));}
    finally{clearTimeout(timer);}
  }
  throw last;
}
function decode(v=''){return String(v).replace(/&amp;/gi,'&').replace(/&quot;|&#34;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');}
function links(html,base){
  const out=[];const re=/\bhref\s*=\s*["']([^"'#]+)["']/gi;let m;
  while((m=re.exec(html))){try{const u=new URL(decode(m[1]),base);if(/^https?:$/.test(u.protocol))out.push(u.href.split('#')[0]);}catch{}}
  return [...new Set(out)];
}
function walkLd(x,out){
  if(Array.isArray(x)){for(const y of x)walkLd(y,out);return;}
  if(!x||typeof x!=='object')return;
  const t=x['@type'];
  if(t==='JobPosting'||(Array.isArray(t)&&t.includes('JobPosting')))out.push(x);
  for(const k of ['@graph','itemListElement','mainEntity','item'])if(x[k])walkLd(x[k],out);
}
function jsonLd(html){
  const out=[];const re=/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;
  while((m=re.exec(html))){for(const raw of [m[1],decode(m[1])]){try{walkLd(JSON.parse(raw),out);break;}catch{}}}
  return out;
}
function arr(v){return Array.isArray(v)?v:[v].filter(Boolean);}
function ldLocation(ld){
  const loc=arr(ld.jobLocation)[0]||{};const a=loc.address||loc;const geo=loc.geo||{};
  const location=clean([a.postalCode,a.addressLocality].filter(Boolean).join(' '))||clean(a.addressLocality||a.addressRegion||'');
  const address=clean([a.streetAddress,a.postalCode,a.addressLocality].filter(Boolean).join(', '));
  return{location,address,lat:Number(geo.latitude),lon:Number(geo.longitude)};
}
function remoteFull(text='',ld={}){
  const s=norm(`${ld.jobLocationType||''} ${text}`);
  if(/telecommute/.test(s)&&!/hybrid|teilweise|gelegentlich|tage pro woche/.test(s))return true;
  return /(100 ?% (remote|homeoffice)|vollstandig remote|vollstaendig remote|komplett remote|fully remote|full remote|reines homeoffice|ausschliesslich homeoffice)/i.test(s)&&!/hybrid|teilweise|gelegentlich/.test(s);
}
function employment(ld,text=''){
  const out=arr(ld.employmentType).map(clean).filter(Boolean);const n=norm(text);
  if(/teilzeit/.test(n)&&!out.some(x=>/teilzeit|part/i.test(x)))out.push('Teilzeit');
  if(/vollzeit/.test(n)&&!out.some(x=>/vollzeit|full/i.test(x)))out.push('Vollzeit');
  if(/minijob/.test(n))out.push('Minijob');
  return[...new Set(out)];
}
function fromLd(ld,url,source,pageText=''){
  const l=ldLocation(ld);const org=ld.hiringOrganization||ld.organization||{};
  const company=clean(typeof org==='string'?org:org.name||'');
  const desc=strip(ld.description||pageText).slice(0,6500);const rf=remoteFull(desc,ld);
  return{
    id:`expanded-${hash(`${source}|${ld.url||url}|${ld.title||ld.name||''}`)}`,
    title:clean(ld.title||ld.name||''),company,location:l.location,address:l.address,
    lat:Number.isFinite(l.lat)?l.lat:null,lon:Number.isFinite(l.lon)?l.lon:null,
    remote:rf,remoteFull:rf,employmentType:employment(ld,desc),
    publishedAt:ld.datePosted||null,validThrough:ld.validThrough||null,
    url:ld.url||url,source,sources:[{name:source,url:ld.url||url}],description:desc,salary:null
  };
}
function fallback(html,url,source){
  const text=strip(html);const h1=strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||'');
  if(!h1||h1.length<4||h1.length>220)return null;
  let company='';
  const companyPatterns=[
    /(?:Arbeitgeber|Unternehmen|Company)\s*:?\s*([^|•]{2,100}?)(?=\s{2,}|Standort|Ort|Vollzeit|Teilzeit|$)/i,
    /(?:bei|von)\s+([A-ZÄÖÜ][^|•]{2,90}?)(?=\s+[|–-]|\s{2,}|$)/
  ];
  for(const r of companyPatterns){const m=text.match(r);if(m){company=clean(m[1]);break;}}
  if(!company)return null;
  const pm=text.match(/\b(1\d{4})\s+(Berlin|Falkensee|Hennigsdorf|Velten|Brieselang|Dallgow-Döberitz|Schönwalde-Glien|Hohen Neuendorf|Wustermark)\b/i);
  const lm=text.match(/\b(Berlin[- ](?:Spandau|Tegel|Reinickendorf|Charlottenburg|Siemensstadt|Haselhorst)|Spandau|Tegel|Reinickendorf|Charlottenburg|Falkensee|Hennigsdorf|Velten|Brieselang|Dallgow-Döberitz|Schönwalde-Glien|Hohen Neuendorf|Wustermark)\b/i);
  const location=pm?`${pm[1]} ${pm[2]}`:(lm?lm[1]:'');const rf=remoteFull(text);
  return{id:`expanded-${hash(`${source}|${url}|${h1}`)}`,title:h1,company,location,address:'',lat:null,lon:null,remote:rf,remoteFull:rf,employmentType:employment({},text),publishedAt:null,validThrough:null,url,source,sources:[{name:source,url}],description:text.slice(0,6500),salary:null};
}
async function geocode(q){
  q=clean(q);if(!q)return null;const key=`expanded15:${norm(q)}`;if(Object.hasOwn(cache,key))return cache[key];
  try{
    await sleep(1050);const u=new URL('https://nominatim.openstreetmap.org/search');u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',q);
    const r=await fetch(u,{headers:{'User-Agent':'Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)','Accept-Language':'de-DE'}});const d=r.ok?await r.json():[];
    cache[key]=d[0]?{lat:+d[0].lat,lon:+d[0].lon,display_name:d[0].display_name}:null;
  }catch{cache[key]=null;}
  return cache[key];
}
async function enrichGeo(j){
  if(j.remoteFull===true||Number.isFinite(j.lat)&&Number.isFinite(j.lon))return j;
  const q=j.address||j.location;if(!q)return j;const g=await geocode(q);
  if(g){j.lat=g.lat;j.lon=g.lon;if(!j.address)j.address=g.display_name;}
  return j;
}
function excluded(j){
  const t=norm(`${j.title} ${(j.description||'').slice(0,800)}`);
  return /(ausbildung|ausbildungsplatz|auszubild|azubi|duales studium|dual studium|werkstudent|working student|praktikum|praktikant|internship|studentische hilfskraft)/i.test(t);
}
function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland)\b/g,' ').replace(/\s+/g,' ').trim();}
function titleTokens(v=''){return new Set(norm(v).split(' ').filter(x=>x.length>2&&!['der','die','das','und','fur','als','mit','bei','von','mwd'].includes(x)));}
function titleSimilarity(a,b){const A=titleTokens(a),B=titleTokens(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size);}
function same(a,b){
  if(a.url&&b.url&&a.url===b.url)return true;
  const ac=companyNorm(a.company),bc=companyNorm(b.company);if(!ac||!bc)return false;
  if(ac!==bc&&!(ac.includes(bc)||bc.includes(ac)))return false;
  return norm(a.title)===norm(b.title)||titleSimilarity(a.title,b.title)>=0.74;
}
function merge(base,j){
  const hit=base.find(x=>same(x,j));
  if(!hit){base.push(j);return'added';}
  hit.sources=Array.isArray(hit.sources)?hit.sources:[];
  if(!hit.sources.some(s=>s.url===j.url))hit.sources.push({name:j.source,url:j.url});
  if(!Number.isFinite(hit.lat)&&Number.isFinite(j.lat)){hit.lat=j.lat;hit.lon=j.lon;hit.address=j.address||hit.address;hit.location=j.location||hit.location;}
  if((j.description||'').length>(hit.description||'').length)hit.description=j.description;
  return'merged';
}
async function parse(html,url,source){
  const text=strip(html);const out=[];
  for(const ld of jsonLd(html)){const j=fromLd(ld,url,source,text);if(j.title&&j.company)out.push(j);}
  if(!out.length){const j=fallback(html,url,source);if(j)out.push(j);}
  return out;
}
async function mapLimit(items,limit,fn){
  const out=[];let i=0;const workers=Array.from({length:Math.min(limit,items.length)},async()=>{while(i<items.length){const idx=i++;try{out.push(...await fn(items[idx]));}catch{}}});
  await Promise.all(workers);return out;
}
async function scan(cfg){
  const candidates=[];const jobs=[];let listOk=0;let lastError='';
  for(const list of cfg.lists){
    try{
      const html=await get(list);listOk++;
      jobs.push(...await parse(html,list,cfg.name));
      for(const href of links(html,list)){try{const u=new URL(href);if(cfg.match(u))candidates.push(u.href);}catch{}}
    }catch(e){lastError=e.message;console.warn(`[${cfg.name}] Liste: ${e.message}`);}
  }
  const unique=[...new Set(candidates)].slice(0,cfg.max);
  const details=await mapLimit(unique,3,async url=>{try{return await parse(await get(url),url,cfg.name);}catch{return[];}});
  jobs.push(...details);
  const cleaned=[];const seen=new Set();
  for(const j of jobs){
    if(!j.title||!j.company||excluded(j))continue;
    const k=`${norm(j.company)}|${norm(j.title)}|${j.url}`;if(seen.has(k))continue;seen.add(k);
    cleaned.push(await enrichGeo(j));
  }
  return{jobs:cleaned,status:listOk?'ok':'blocked',note:listOk?'':lastError};
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));payload.jobs=Array.isArray(payload.jobs)?payload.jobs:[];payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}
  let totalAdded=0,totalMerged=0;
  for(const cfg of SOURCES){
    const result=await scan(cfg);let added=0,merged=0;
    for(const j of result.jobs){const r=merge(payload.jobs,j);if(r==='added'){added++;totalAdded++;}else{merged++;totalMerged++;}}
    const row={name:cfg.name,count:added,status:result.status,...(result.note?{note:result.note}:{})};
    const old=payload.meta.sources.find(x=>x.name===cfg.name);if(old)Object.assign(old,row);else payload.meta.sources.push(row);
    console.log(`[${cfg.name}] ${added} neu, ${merged} zusammengeführt (${result.status})`);
  }
  payload.meta.expanded15kmPortals=true;payload.meta.expanded15kmPortalCount=SOURCES.length;payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');
  console.log(`Erweiterte 15-km-Portale: ${totalAdded} neue, ${totalMerged} zusammengeführt.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
