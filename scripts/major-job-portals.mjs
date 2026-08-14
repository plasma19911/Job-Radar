import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT='public/data/jobs.json';
const CACHE='data/geocode-cache.json';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36 Job-Radar/1.0';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß]+/g,' ').replace(/\s+/g,' ').trim();
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);
const decode=s=>String(s||'').replace(/&quot;|&#34;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&nbsp;/gi,' ');
const strip=s=>clean(decode(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')));

const PORTALS=[
  {name:'StepStone',lists:['https://www.stepstone.de/jobs/buero-verwaltung/in-berlin-spandau?radius=10','https://www.stepstone.de/jobs/spandau/in-berlin'],host:/stepstone\.de$/i,match:u=>/\/stellenangebote--/i.test(u.pathname),max:8},
  {name:'Indeed',lists:['https://de.indeed.com/jobs?q=B%C3%BCro&l=Berlin-Spandau&radius=10&sort=date'],host:/indeed\.com$/i,match:u=>/\/(viewjob|rc\/clk|pagead\/clk)/i.test(u.pathname),max:8},
  {name:'XING Jobs',lists:['https://www.xing.com/jobs/jobs-in-berlin-spandau','https://www.xing.com/jobs/skill/b%C3%BCro-jobs-in-berlin'],host:/xing\.com$/i,match:u=>/^\/jobs\/(?!jobs-|skill\/|search)/i.test(u.pathname)&&/\d{6,}/.test(u.pathname),max:8},
  {name:'LinkedIn Jobs',lists:['https://de.linkedin.com/jobs/search?keywords=B%C3%BCro%20Sachbearbeitung%20Assistenz&location=Berlin-Spandau%2C%20Berlin%2C%20Deutschland'],host:/linkedin\.com$/i,match:u=>/\/jobs\/view\//i.test(u.pathname),max:8},
  {name:'Monster',lists:['https://www.monster.de/jobs/q-buero-jobs-l-berlin-spandau','https://www.monster.de/jobs/q-sachbearbeiter-jobs-l-berlin'],host:/monster\.de$/i,match:u=>/job-openings|stellenangebot|\/job\//i.test(u.pathname),max:6},
  {name:'Jobware',lists:['https://www.jobware.de/jobs/berlin','https://www.jobware.de/'],host:/jobware\.de$/i,match:u=>/\/job\/|\/jobs\/[^/?]+\/[^/?]+/i.test(u.pathname),max:6},
  {name:'meinestadt.de',lists:['https://jobs.meinestadt.de/berlin'],host:/meinestadt\.de$/i,match:u=>/\/job\/|\/jkl\/|\/stellenangebot/i.test(u.pathname),max:7},
  {name:'stellenanzeigen.de',lists:['https://www.stellenanzeigen.de/jobs/sachbearbeiter-in/berlin/','https://www.stellenanzeigen.de/jobs/assistenz/berlin/'],host:/stellenanzeigen\.de$/i,match:u=>/\/job\/|\/stellenangebot\//i.test(u.pathname),max:8},
  {name:'Jooble',lists:['https://de.jooble.org/stellenangebote-b%C3%BCro/Spandau%2C-Berlin','https://de.jooble.org/stellenangebote-b%C3%BCroassistenz/Spandau%2C-Berlin'],host:/jooble\.org$/i,match:u=>/\/desc\/|\/stellenangebot\//i.test(u.pathname),max:7},
  {name:'Glassdoor',lists:['https://www.glassdoor.de/Job/berlin-b%C3%BCro-jobs-SRCH_IL.0,6_IC2622109_KO7,11.htm'],host:/glassdoor\.de$/i,match:u=>/job-listing/i.test(u.pathname),max:6},
  {name:'Talent.com',lists:['https://de.talent.com/jobs/k-b%C3%BCrokaufmann-l-berlin','https://de.talent.com/jobs/k-office-administrator-l-berlin'],host:/talent\.com$/i,match:u=>/\/view\?id=/i.test(`${u.pathname}${u.search}`),max:8}
];

let cache={};
async function get(url){
  const c=new AbortController();const timer=setTimeout(()=>c.abort(),14000);
  try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9,en;q=0.5','Accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:c.signal});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();}
  finally{clearTimeout(timer);}
}
async function geocode(q){
  q=clean(q);if(!q)return null;const key=`major-portals:${norm(q)}`;if(Object.hasOwn(cache,key))return cache[key];
  try{await sleep(1050);const u=new URL('https://nominatim.openstreetmap.org/search');u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',q);const r=await fetch(u,{headers:{'User-Agent':'Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)','Accept-Language':'de-DE'}});const d=r.ok?await r.json():[];cache[key]=d[0]?{lat:+d[0].lat,lon:+d[0].lon,display_name:d[0].display_name}:null;}catch{cache[key]=null;}return cache[key];
}
function links(html,base){const out=[];const re=/\bhref\s*=\s*["']([^"'#]+)["']/gi;let m;while((m=re.exec(html))){try{const u=new URL(decode(m[1]),base);if(/^https?:$/.test(u.protocol))out.push(u.href.split('#')[0]);}catch{}}return [...new Set(out)];}
function jsonLd(html){const out=[];const re=/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;while((m=re.exec(html))){for(const raw of [m[1],decode(m[1])]){try{const root=JSON.parse(raw);walk(root,out);break;}catch{}}}return out;}
function walk(x,out){if(Array.isArray(x)){for(const y of x)walk(y,out);return;}if(!x||typeof x!=='object')return;const t=x['@type'];if(t==='JobPosting'||(Array.isArray(t)&&t.includes('JobPosting')))out.push(x);for(const k of ['@graph','itemListElement','mainEntity'])if(x[k])walk(x[k],out);}
function arr(v){return Array.isArray(v)?v:[v].filter(Boolean);}
function locationFromLd(ld){const loc=arr(ld.jobLocation)[0]||{};const a=loc.address||loc;const geo=loc.geo||{};return{location:clean([a.postalCode,a.addressLocality].filter(Boolean).join(' '))||clean(a.addressLocality||a.addressRegion),address:clean([a.streetAddress,a.postalCode,a.addressLocality].filter(Boolean).join(', ')),lat:Number(geo.latitude),lon:Number(geo.longitude)};}
function remoteFull(text,ld={}){const s=norm(`${ld.jobLocationType||''} ${text||''}`);if(/telecommute/.test(s)&&!/hybrid|teilweise|gelegentlich|tage pro woche|pro woche im buro/.test(s))return true;return /(100 ?% (remote|homeoffice)|vollstandig remote|vollstaendig remote|komplett remote|fully remote|full remote|reines homeoffice|ausschliesslich homeoffice)/i.test(s)&&!/hybrid|teilweise|gelegentlich/.test(s);}
function employment(ld,text=''){const a=arr(ld.employmentType).map(clean);const n=norm(text);if(/teilzeit/.test(n)&&!a.some(x=>/teilzeit|part/i.test(x)))a.push('Teilzeit');if(/vollzeit/.test(n)&&!a.some(x=>/vollzeit|full/i.test(x)))a.push('Vollzeit');if(/minijob/.test(n))a.push('Minijob');return[...new Set(a)];}
function fromLd(ld,url,source,pageText=''){const l=locationFromLd(ld);const company=typeof ld.hiringOrganization==='string'?ld.hiringOrganization:ld.hiringOrganization?.name||ld.organization?.name||'';const desc=strip(ld.description||pageText).slice(0,6500);return{title:clean(ld.title||ld.name),company:clean(company),location:l.location,address:l.address,lat:Number.isFinite(l.lat)?l.lat:null,lon:Number.isFinite(l.lon)?l.lon:null,remote:remoteFull(desc,ld),remoteFull:remoteFull(desc,ld),employmentType:employment(ld,desc),publishedAt:ld.datePosted||null,validThrough:ld.validThrough||null,url:ld.url||url,source,sources:[{name:source,url:ld.url||url}],description:desc,salary:null};}
function meta(html,name){const patterns=[new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`,'i'),new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`,'i')];for(const r of patterns){const m=html.match(r);if(m)return clean(decode(m[1]));}return'';}
function fallbackJob(html,url,source){const text=strip(html);let title=clean((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||meta(html,'og:title')||meta(html,'twitter:title'));title=strip(title).replace(/\s+[|–-]\s+(Indeed|StepStone|XING|LinkedIn|Monster|Jobware|meinestadt|stellenanzeigen\.de|Jooble|Glassdoor|Talent\.com).*$/i,'');if(title.length<4||title.length>220)return null;let company='';const cm=text.match(/(?:Unternehmen|Arbeitgeber|Company)\s*:?\s*([^|•]{2,100}?)(?=\s{2,}|Ort|Standort|Berlin|Vollzeit|Teilzeit|$)/i);if(cm)company=clean(cm[1]);const postal=(text.match(/\b(1(?:3[0-9]{3}|4[0-9]{3}))\s+(Berlin|Falkensee|Hennigsdorf|Wustermark|Dallgow-Döberitz|Schönwalde-Glien)\b/i)||[]);let location=postal?`${postal[1]} ${postal[2]}`:'';if(!location){const lm=text.match(/\b(Berlin[- ]Spandau|Spandau(?:, Berlin)?|Berlin[- ]Tegel|Tegel(?:, Berlin)?|Berlin[- ]Reinickendorf|Falkensee|Hennigsdorf|Wustermark|Dallgow-Döberitz|Schönwalde-Glien)\b/i);if(lm)location=lm[1];}if(!company){const og=meta(html,'og:description');const x=og.match(/^([^–|]{2,90})\s+[–|-]/);if(x)company=clean(x[1]);}if(!company)return null;const rf=remoteFull(text);return{title,company,location,address:'',lat:null,lon:null,remote:rf,remoteFull:rf,employmentType:employment({},text),publishedAt:null,validThrough:null,url,source,sources:[{name:source,url}],description:text.slice(0,6500),salary:null};}
function excluded(j){const t=norm(`${j.title} ${j.description.slice(0,500)}`);return /(ausbildung|ausbildungsplatz|auszubild|azubi|duales studium|dual studium|werkstudent|working student|praktikum|praktikant|internship)/i.test(t);}
function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland)\b/g,' ').replace(/\s+/g,' ').trim();}
function titleTokens(v=''){return new Set(norm(v).split(' ').filter(x=>x.length>2&&!['der','die','das','und','fur','als','mit','bei','von','mwd'].includes(x)));}
function titleSimilarity(a,b){const A=titleTokens(a),B=titleTokens(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size);}
function same(a,b){const ac=companyNorm(a.company),bc=companyNorm(b.company);if(!ac||!bc)return false;if(ac!==bc&&!(ac.includes(bc)||bc.includes(ac)))return false;return norm(a.title)===norm(b.title)||titleSimilarity(a.title,b.title)>=0.72;}
function merge(base,j){const hit=base.find(x=>same(x,j));if(!hit){j.id=`portal-${hash(`${j.source}|${j.company}|${j.title}|${j.url}`)}`;base.push(j);return'added';}hit.sources=Array.isArray(hit.sources)?hit.sources:[];if(!hit.sources.some(s=>s.url===j.url))hit.sources.push({name:j.source,url:j.url});if(!hit.lat&&j.lat){hit.lat=j.lat;hit.lon=j.lon;hit.address=j.address||hit.address;hit.location=j.location||hit.location;}if(j.remoteFull===true){hit.remote=true;hit.remoteFull=true;}return'merged';}
async function enrichGeo(j){if(Number.isFinite(j.lat)&&Number.isFinite(j.lon))return j;const q=j.address||j.location;if(!q)return j;const g=await geocode(q);if(g){j.lat=g.lat;j.lon=g.lon;if(!j.address)j.address=g.display_name;}return j;}
async function parsePage(html,url,source){const text=strip(html);const lds=jsonLd(html);const jobs=[];for(const ld of lds){const j=fromLd(ld,url,source,text);if(j.title&&j.company)jobs.push(j);}if(!jobs.length){const j=fallbackJob(html,url,source);if(j)jobs.push(j);}return jobs;}
async function mapLimit(items,limit,fn){const out=[];let i=0;const workers=Array.from({length:Math.min(limit,items.length)},async()=>{while(i<items.length){const idx=i++;try{out.push(...await fn(items[idx]));}catch{}}});await Promise.all(workers);return out;}

async function scanPortal(cfg){
  const candidates=[];const jobs=[];let listOk=0;let lastError='';
  for(const list of cfg.lists){try{const html=await get(list);listOk++;jobs.push(...await parsePage(html,list,cfg.name));for(const href of links(html,list)){try{const u=new URL(href);if(cfg.host.test(u.hostname)&&cfg.match(u))candidates.push(u.href);}catch{}}}catch(e){lastError=e.message;console.warn(`[${cfg.name}] Liste ${list}: ${e.message}`);}}
  const unique=[...new Set(candidates)].slice(0,cfg.max);
  if(unique.length){const detail=await mapLimit(unique,3,async url=>{try{const html=await get(url);return await parsePage(html,url,cfg.name);}catch(e){console.warn(`[${cfg.name}] Detail: ${e.message}`);return[];}});jobs.push(...detail);}
  const cleaned=[];const seen=new Set();for(const j of jobs){if(!j.title||!j.company||excluded(j))continue;const key=`${norm(j.company)}|${norm(j.title)}`;if(seen.has(key))continue;seen.add(key);cleaned.push(await enrichGeo(j));}
  return{jobs:cleaned,status:listOk?'ok':'blocked',error:lastError};
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}
  payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  let added=0,merged=0;
  for(const cfg of PORTALS){
    let r;try{r=await scanPortal(cfg);}catch(e){r={jobs:[],status:'error',error:e.message};}
    let accepted=0;for(const j of r.jobs){const m=merge(payload.jobs,j);m==='added'?added++:merged++;accepted++;}
    const hit=payload.meta.sources.find(x=>x.name===cfg.name);const entry={name:cfg.name,count:accepted,status:r.status};if(r.error&&r.status!=='ok')entry.note=r.error.slice(0,100);if(hit)Object.assign(hit,entry);else payload.meta.sources.push(entry);
    console.log(`[${cfg.name}] ${accepted} Treffer (${r.status})`);
  }
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;payload.meta.majorJobPortals=true;payload.meta.majorJobPortalsCount=PORTALS.length;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');
  console.log(`Große Jobportale: ${added} neue, ${merged} mit vorhandenen Stellen zusammengeführt.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
