import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT='public/data/jobs.json';
const CACHE='data/geocode-cache.json';
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const strip=v=>clean(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&auml;/gi,'ä').replace(/&ouml;/gi,'ö').replace(/&uuml;/gi,'ü').replace(/&szlig;/gi,'ß'));
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß]+/g,' ').replace(/\s+/g,' ').trim();
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);

async function get(url){const c=new AbortController();const timer=setTimeout(()=>c.abort(),22000);try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9'},redirect:'follow',signal:c.signal});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();}finally{clearTimeout(timer);}}
let cache={};
async function geocode(q){const key=`tegel-office:${norm(q)}`;if(Object.hasOwn(cache,key))return cache[key];try{await sleep(1100);const u=new URL('https://nominatim.openstreetmap.org/search');u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',q);const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'de-DE'}});const d=r.ok?await r.json():[];cache[key]=d[0]?{lat:+d[0].lat,lon:+d[0].lon,display_name:d[0].display_name}:null;}catch{cache[key]=null;}return cache[key];}
function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland)\b/g,' ').replace(/\s+/g,' ').trim();}
function same(a,b){const ac=companyNorm(a.company),bc=companyNorm(b.company);if(!ac||!bc||ac!==bc)return false;const at=norm(a.title),bt=norm(b.title);return at===bt||(at.length>12&&bt.length>12&&(at.includes(bt)||bt.includes(at)));}
function merge(base,j){const hit=base.find(x=>same(x,j));if(!hit){base.push(j);return'added';}hit.sources=Array.isArray(hit.sources)?hit.sources:[];if(!hit.sources.some(s=>s.url===j.url))hit.sources.push({name:j.source,url:j.url});if(!hit.lat&&j.lat){hit.lat=j.lat;hit.lon=j.lon;hit.address=j.address;}if((j.description||'').length>(hit.description||'').length)hit.description=j.description;return'merged';}
function job(cfg,text,geo){return {id:`tegel-office-${hash(cfg.url)}`,title:cfg.title,company:cfg.company,location:'Berlin-Tegel',address:geo?.display_name||cfg.address,lat:geo?.lat??null,lon:geo?.lon??null,remote:false,remoteFull:false,employmentType:cfg.employmentType||[],publishedAt:null,validThrough:null,url:cfg.url,source:cfg.source,sources:[{name:cfg.source,url:cfg.url}],description:text.slice(0,7000),salary:null};}

const JOBS=[
  {source:'GÖK Consulting Tegel direkt',company:'GÖK Consulting GmbH',title:'Officemanager (w/m/d)',key:'officemanager',address:'Am Borsigturm 13, 13507 Berlin',url:'https://goek.consulting/officemanager-w-m-d/',employmentType:['Teilzeit']},
  {source:'RENAFAN Tegel direkt',company:'RENAFAN GmbH',title:'Kauffrau im Gesundheitswesen (m/w/d) Schwerpunkt Debitorenbuchhaltung',key:'debitorenbuchhaltung',address:'Berliner Straße 36/37, 13507 Berlin',url:'https://www.renafan.de/karriere/jobs/berlin-kauffrau-im-gesundheitswesen-mwd-schwerpunkt-debitorenbuchhaltung-berlin-tegel',employmentType:['Vollzeit']},
  {source:'RENAFAN Tegel direkt',company:'RENAFAN GmbH',title:'Buchhalter (m/w/d) in der Hauptbuchhaltung',key:'hauptbuchhaltung',address:'Berliner Straße 36/37, 13507 Berlin',url:'https://www.renafan.de/karriere/jobs/berlin-buchhalter-mwd-der-hauptbuchhaltung',employmentType:['Vollzeit','Teilzeit']},
  {source:'RENAFAN Tegel direkt',company:'RENAFAN GmbH',title:'Finanzbuchhalter (m/w/d)',key:'finanzbuchhalter',address:'Berliner Straße 36/37, 13507 Berlin',url:'https://www.renafan.de/karriere/jobs/berlin-finanzbuchhalter-mwd',employmentType:['Vollzeit','Teilzeit']},
  {source:'RENAFAN Tegel direkt',company:'RENAFAN GmbH',title:'Controller (m/w/d)',key:'controller',address:'Berliner Straße 36/37, 13507 Berlin',url:'https://www.renafan.de/karriere/jobs/berlin-controller-mwd',employmentType:['Vollzeit','Teilzeit']}
];

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}
  let added=0,merged=0;const counts=new Map();
  for(const cfg of JOBS){
    try{const html=await get(cfg.url),text=strip(html);if(!norm(text).includes(norm(cfg.key))){console.warn(`[${cfg.source}] Titel nicht mehr gefunden: ${cfg.title}`);continue;}const geo=await geocode(cfg.address);const r=merge(payload.jobs,job(cfg,text,geo));r==='added'?added++:merged++;counts.set(cfg.source,(counts.get(cfg.source)||0)+1);}catch(e){console.warn(`[${cfg.source}] ${cfg.title}: ${e.message}`);}
  }
  payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  for(const source of [...new Set(JOBS.map(x=>x.source))]){const count=counts.get(source)||0;const hit=payload.meta.sources.find(x=>x.name===source);if(hit){hit.count=count;hit.status='ok';}else payload.meta.sources.push({name:source,count,status:'ok'});}
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;payload.meta.tegelOfficeDirect=true;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');
  console.log(`Tegeler Büro-Direktsuche: ${added} neue, ${merged} zusammengeführt.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
