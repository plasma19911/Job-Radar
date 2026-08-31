import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Direkte oeffentliche Personio-Karrierefeeds ohne persoenlichen API-Key.
// Personio stellt veroeffentlichte Positionen unter COMPANY.jobs.personio.de/xml bereit.
const OUT='public/data/jobs.json';
const CACHE='data/geocode-cache.json';
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const decode=v=>String(v??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
const strip=v=>clean(decode(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')));
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß%]+/g,' ').replace(/\s+/g,' ').trim();
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);
const excluded=v=>/(senior|\bsr\b|ausbildung|ausbildungsplatz|auszubild|azubi|lehrstelle|duales studium|dual studium|dualstudent|berufsausbildung|werkstudent|werkstudentin|working student|praktikum|praktikant|praktikantin|internship|\bintern\b|trainee)/i.test(norm(v));
const officeLike=v=>/(sachbearbeit|büro|buero|office|verwaltung|administrat|assistenz|assistant|sekret|empfang|rezeption|kundenservice|customer care|customer support|support agent|backoffice|claims|schaden|invoic|payment|rechnung|buchhalt|account|finance|finanz|controlling|personal|people|human resources|\bhr\b|recruit|einkauf|procurement|vertriebsinnendienst|sales support|daten|data|it operations|it support|service desk|operations|koordination|coordinator|projekt|project|legal|recht|compliance|kaufmänn|kaufmaenn|payroll|abrechnung|disponent|disposition|immobilien|property|vermietung)/i.test(norm(v));
const physical=v=>/(fahrer|reiniger|reinigung|kfz|mechatron|lackierer|karosserie|werkstatt|elektriker|lager|logistikmitarbeiter|handwerker|hausmeister|therapeut|pflege|medizinische fachangestellte|zahnarzt|zahnmedizin|koch|küche|kueche)/i.test(norm(v));
const hybrid=v=>/(hybrid|teilweise homeoffice|teilweise remote|tage pro woche|tage im büro|tage im buero|office days|onsite days)/i.test(norm(v));
const fullRemote=v=>{const t=norm(v);if(hybrid(t))return false;return /(100 ?% ?(remote|homeoffice)|fully remote|full remote|remote only|komplett remote|vollständig remote|vollstaendig remote|reines homeoffice|ausschließlich homeoffice|ausschliesslich homeoffice|ortsunabhängig|ortsunabhangig)/i.test(t);};

const FEEDS=[
  {account:'miles-mobility',company:'MILES Mobility GmbH',address:'Leibnizstraße 49, 10629 Berlin',location:'Berlin'},
  {account:'empira',company:'Empira Asset Management GmbH',address:'Kurfürstendamm 213, 10719 Berlin',location:'Berlin'},
  {account:'wohn-union',company:'WOHN-UNION Immobilienmanagement GmbH',address:'Am Borsigturm 53, 13507 Berlin',location:'Berlin-Tegel'}
];

async function getText(url){const c=new AbortController();const t=setTimeout(()=>c.abort(),22000);try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9'},redirect:'follow',signal:c.signal});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();}finally{clearTimeout(t);}}
function tag(block,name){const m=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));return m?strip(m[1]):'';}
function description(block){const m=block.match(/<jobDescriptions(?:\s[^>]*)?>([\s\S]*?)<\/jobDescriptions>/i);return m?strip(m[1]):'';}
function positions(xml){return [...String(xml).matchAll(/<position(?:\s[^>]*)?>([\s\S]*?)<\/position>/gi)].map(m=>m[1]);}

let cache={};
async function geocode(q){const key=`personio:${norm(q)}`;if(Object.hasOwn(cache,key))return cache[key];try{await sleep(1050);const u=new URL('https://nominatim.openstreetmap.org/search');u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',q);const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'de-DE'}});const d=r.ok?await r.json():[];cache[key]=d[0]?{lat:+d[0].lat,lon:+d[0].lon,address:d[0].display_name}:null;}catch{cache[key]=null;}return cache[key];}
function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland|immobilienmanagement|asset management)\b/g,' ').replace(/\s+/g,' ').trim();}
function tokens(v=''){return new Set(norm(v).split(' ').filter(x=>x.length>2&&!['der','die','das','und','fur','als','mit','bei','von','mwd','wmd','wmxd'].includes(x)));}
function similarity(a,b){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size);}
function same(a,b){if(a.url&&b.url&&a.url===b.url)return true;const ac=companyNorm(a.company),bc=companyNorm(b.company);if(!ac||!bc||!(ac===bc||ac.includes(bc)||bc.includes(ac)))return false;return norm(a.title)===norm(b.title)||similarity(a.title,b.title)>=0.78;}
function merge(base,j){const hit=base.find(x=>same(x,j));if(!hit){base.push(j);return'added';}hit.sources=Array.isArray(hit.sources)?hit.sources:[];if(!hit.sources.some(s=>s.url===j.url))hit.sources.push({name:j.source,url:j.url});if(!hit.lat&&j.lat){hit.lat=j.lat;hit.lon=j.lon;hit.address=j.address;}if((j.description||'').length>(hit.description||'').length)hit.description=j.description;if(j.remoteFull===true){hit.remote=true;hit.remoteFull=true;}return'merged';}

async function readFeed(cfg){
  const source=`${cfg.company} direkt (Personio)`,out=[];
  const xml=await getText(`https://${cfg.account}.jobs.personio.de/xml?language=de`);
  const geo=await geocode(cfg.address);
  for(const block of positions(xml)){
    const id=tag(block,'id'),title=tag(block,'name'),office=tag(block,'office'),department=tag(block,'department'),employment=tag(block,'employmentType'),schedule=tag(block,'schedule'),desc=description(block);
    const text=`${title} ${office} ${department} ${employment} ${schedule} ${desc}`;
    if(!id||!title||excluded(text)||physical(title)||!officeLike(text))continue;
    const berlin=/berlin|tegel|spandau/i.test(`${office} ${cfg.location}`);const remote=fullRemote(text);
    if(!berlin&&!remote)continue;
    const url=`https://${cfg.account}.jobs.personio.de/job/${encodeURIComponent(id)}?language=de`;
    out.push({id:`personio-${cfg.account}-${id||hash(url)}`,title:clean(title),company:cfg.company,location:clean(office||cfg.location),address:remote?'':(geo?.address||cfg.address),lat:remote?null:(geo?.lat??null),lon:remote?null:(geo?.lon??null),remote,remoteFull:remote?true:undefined,employmentType:[employment,schedule].filter(Boolean),publishedAt:null,validThrough:null,url,source,sources:[{name:source,url}],description:desc.slice(0,6500),salary:null});
  }
  return {source,jobs:out};
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}payload.jobs=Array.isArray(payload.jobs)?payload.jobs:[];payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  let totalAdded=0,totalMerged=0;
  for(const cfg of FEEDS){let r;try{r=await readFeed(cfg);}catch(e){console.warn(`[Personio] ${cfg.account}: ${e.message}`);r={source:`${cfg.company} direkt (Personio)`,jobs:[]};}let added=0,merged=0;for(const j of r.jobs){const x=merge(payload.jobs,j);x==='added'?added++:merged++;}totalAdded+=added;totalMerged+=merged;const entry={name:r.source,count:r.jobs.length,status:'ok'};const old=payload.meta.sources.find(x=>x.name===r.source);if(old)Object.assign(old,entry);else payload.meta.sources.push(entry);console.log(`[${r.source}] ${r.jobs.length} brauchbar, ${added} neu, ${merged} zusammengeführt`);}
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;payload.meta.personioPublicFeeds=true;await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');console.log(`Personio No-Key: ${totalAdded} neue, ${totalMerged} zusammengeführt.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
