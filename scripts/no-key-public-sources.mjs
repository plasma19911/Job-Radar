import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Oeffentliche Quellen ohne persoenliche API-Keys.
// Alle Treffer laufen danach weiterhin durch exclude-unwanted, office-profile,
// scope-jobs (15 km / echtes 100%-Homeoffice) und den Dublettenfilter.
const OUT='public/data/jobs.json';
const CACHE='data/geocode-cache.json';
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß%]+/g,' ').replace(/\s+/g,' ').trim();
const strip=v=>clean(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>'));
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);
const excluded=v=>/(ausbildung|ausbildungsplatz|auszubild|azubi|lehrstelle|duales studium|dual studium|dualstudent|berufsausbildung|werkstudent|werkstudentin|working student|studentische hilfskraft|praktikum|praktikant|praktikantin|internship|\bintern\b)/i.test(norm(v));
const officeLike=v=>/(sachbearbeit|büro|buero|office|verwaltung|administrat|assistenz|assistant|sekret|empfang|rezeption|kundenservice|customer|support|backoffice|buchhalt|accountant|finance|finanz|controlling|personal|people|human resources|\bhr\b|recruit|einkauf|procurement|vertriebsinnendienst|sales support|daten|data|it support|service desk|operations|operation|koordination|coordinator|projekt|project|legal|recht|compliance|kaufmänn|kaufmaenn|payroll|abrechnung|disponent|disposition)/i.test(norm(v));
const hybrid=v=>/(hybrid|teilweise homeoffice|teilweise remote|tage pro woche|tage im büro|tage im buero|office days|on-site days|onsite days)/i.test(norm(v));
const remoteFull=v=>{const t=norm(v);if(hybrid(t))return false;return /(100 ?% ?(remote|homeoffice)|fully remote|full remote|remote only|komplett remote|vollständig remote|vollstaendig remote|reines homeoffice|ausschließlich homeoffice|ausschliesslich homeoffice|ortsunabhängig|ortsunabhangig|remote)/i.test(t);};
const germanyEvidence=v=>/(deutschland|germany|berlin|brandenburg|potsdam|falkensee|hennigsdorf|german|deutsch|europe.*germany|germany.*remote)/i.test(clean(v));

async function get(url,{json=true,tries=2,headers={}}={}){
  let last;
  for(let i=0;i<tries;i++){
    const c=new AbortController();const timer=setTimeout(()=>c.abort(),22000);
    try{
      const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9,en;q=0.5','Accept':json?'application/json,text/plain;q=0.8,*/*;q=0.5':'text/html,*/*;q=0.5',...headers},redirect:'follow',signal:c.signal});
      if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
      return json?await r.json():await r.text();
    }catch(e){last=e;if(i<tries-1)await sleep(600*(i+1));}
    finally{clearTimeout(timer);}
  }
  throw last;
}

let geoCache={};
async function geocode(q){
  q=clean(q);if(!q)return null;
  const key=`nokey:${norm(q)}`;
  if(Object.hasOwn(geoCache,key))return geoCache[key];
  try{
    await sleep(1050);
    const u=new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',q);
    const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'de-DE'}});
    const d=r.ok?await r.json():[];
    geoCache[key]=d[0]?{lat:+d[0].lat,lon:+d[0].lon,address:d[0].display_name}:null;
  }catch{geoCache[key]=null;}
  return geoCache[key];
}

function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland)\b/g,' ').replace(/\s+/g,' ').trim();}
function titleTokens(v=''){return new Set(norm(v).split(' ').filter(x=>x.length>2&&!['der','die','das','und','fur','als','mit','bei','von','mwd','all','genders'].includes(x)));}
function similarity(a,b){const A=titleTokens(a),B=titleTokens(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size);}
function same(a,b){if(a.url&&b.url&&a.url===b.url)return true;const ac=companyNorm(a.company),bc=companyNorm(b.company);if(!ac||!bc||!(ac===bc||ac.includes(bc)||bc.includes(ac)))return false;return norm(a.title)===norm(b.title)||similarity(a.title,b.title)>=0.75;}
function merge(base,j){const hit=base.find(x=>same(x,j));if(!hit){base.push(j);return'added';}hit.sources=Array.isArray(hit.sources)?hit.sources:[];if(!hit.sources.some(s=>s.url===j.url))hit.sources.push({name:j.source,url:j.url});if(!hit.lat&&j.lat){hit.lat=j.lat;hit.lon=j.lon;hit.address=j.address;}if((j.description||'').length>(hit.description||'').length)hit.description=j.description;if(!hit.salary&&j.salary)hit.salary=j.salary;if(j.remoteFull===true){hit.remote=true;hit.remoteFull=true;}return'merged';}
function job(o){return{id:o.id||`nokey-${hash(`${o.source}|${o.company}|${o.title}|${o.url}`)}`,title:clean(o.title),company:clean(o.company),location:clean(o.location),address:clean(o.address),lat:Number.isFinite(o.lat)?o.lat:null,lon:Number.isFinite(o.lon)?o.lon:null,remote:o.remoteFull===true||o.remote===true,remoteFull:o.remoteFull===true?true:undefined,employmentType:Array.isArray(o.employmentType)?o.employmentType.filter(Boolean).map(clean):[clean(o.employmentType)].filter(Boolean),publishedAt:o.publishedAt||null,validThrough:null,url:o.url,source:o.source,sources:[{name:o.source,url:o.url}],description:strip(o.description).slice(0,6500),salary:o.salary||null};}
async function enrich(j){if(j.remoteFull===true)return j;if(Number.isFinite(j.lat)&&Number.isFinite(j.lon))return j;let q=j.address||j.location;if(!q)return j;if(/(^|,|\s)berlin(,|\s|$)/i.test(q)&&!/germany|deutschland/i.test(q))q+=', Deutschland';const g=await geocode(q);if(g){j.lat=g.lat;j.lon=g.lon;j.address=j.address||g.address;}return j;}

// Remote OK: oeffentlicher JSON/API-Feed, kein persoenlicher Key.
async function remoteOk(){
  const source='Remote OK',out=[];
  try{
    const d=await get('https://remoteok.com/api');
    const rows=Array.isArray(d)?d:[];
    for(const o of rows){
      if(!o||!o.position||!o.company)continue;
      const text=`${o.position} ${o.description||''} ${(o.tags||[]).join(' ')} ${o.location||''}`;
      if(excluded(text)||!officeLike(text)||!germanyEvidence(text))continue;
      const url=o.url||o.apply_url;if(!url)continue;
      out.push(job({id:`remoteok-${o.id||hash(url)}`,title:o.position,company:o.company,location:o.location||'Remote',remote:true,remoteFull:true,employmentType:[],publishedAt:o.date||o.epoch?new Date(o.date||Number(o.epoch)*1000).toISOString():null,url,description:o.description,source,salary:o.salary_min||o.salary_max?`${o.salary_min||''}-${o.salary_max||''}`:null}));
    }
  }catch(e){console.warn(`[${source}] ${e.message}`);}
  return out;
}

const GREENHOUSE=[
  {board:'n26',company:'N26'},
  {board:'hellofresh',company:'HelloFresh'},
  {board:'atolls',company:'Atolls'}
];
async function greenhouse(){
  const source='Greenhouse öffentlich',out=[];
  for(const cfg of GREENHOUSE){
    try{
      const d=await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(cfg.board)}/jobs?content=true`);
      for(const o of d.jobs||[]){
        const text=`${o.title||''} ${o.content||''} ${o.location?.name||''}`;
        if(excluded(text)||!officeLike(text)||!germanyEvidence(text))continue;
        const full=remoteFull(text);const j=job({id:`gh-${cfg.board}-${o.id}`,title:o.title,company:cfg.company,location:o.location?.name||'',remote:full,remoteFull:full,employmentType:[],publishedAt:o.updated_at||null,url:o.absolute_url,description:o.content,source});out.push(await enrich(j));
      }
    }catch(e){console.warn(`[${source}] ${cfg.board}: ${e.message}`);}
  }
  return out;
}

const LEVER=[
  {site:'xsolla',company:'Xsolla',eu:false},
  {site:'lovehoneygroup',company:'Lovehoney Group',eu:true},
  {site:'octoenergy',company:'Octopus Energy Group',eu:false},
  {site:'netlight',company:'Netlight',eu:false}
];
async function lever(){
  const source='Lever öffentlich',out=[];
  for(const cfg of LEVER){
    const base=cfg.eu?'https://api.eu.lever.co':'https://api.lever.co';
    try{
      const rows=await get(`${base}/v0/postings/${encodeURIComponent(cfg.site)}?mode=json&limit=200`);
      for(const o of Array.isArray(rows)?rows:[]){
        const loc=clean(o.categories?.location||'');const work=clean(o.workplaceType||o.categories?.commitment||'');const desc=strip(`${o.descriptionPlain||o.description||''} ${(o.lists||[]).map(x=>`${x.text||''} ${x.content||''}`).join(' ')}`);const text=`${o.text||''} ${loc} ${work} ${desc}`;
        if(excluded(text)||!officeLike(text)||!germanyEvidence(text))continue;
        const full=/remote/i.test(work)&&!hybrid(work);const j=job({id:`lever-${cfg.site}-${o.id}`,title:o.text,company:cfg.company,location:loc,remote:full,remoteFull:full,employmentType:[o.categories?.commitment].filter(Boolean),publishedAt:o.createdAt?new Date(Number(o.createdAt)).toISOString():null,url:o.hostedUrl||o.applyUrl,description:desc,source});out.push(await enrich(j));
      }
    }catch(e){console.warn(`[${source}] ${cfg.site}: ${e.message}`);}
  }
  return out;
}

const ASHBY=[
  {board:'nelly',company:'Nelly Solutions'},
  {board:'lightspeedhq',company:'Lightspeed'},
  {board:'Clera',company:'Clera'}
];
async function ashby(){
  const source='Ashby öffentlich',out=[];
  for(const cfg of ASHBY){
    try{
      const d=await get(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(cfg.board)}?includeCompensation=true`);
      for(const o of d.jobs||[]){
        if(o.isListed===false)continue;
        const loc=clean(o.location||o.address?.addressLocality||'');const type=clean(o.locationType||'');const desc=o.descriptionPlain||o.descriptionHtml||'';const text=`${o.title||''} ${loc} ${type} ${desc}`;
        if(excluded(text)||!officeLike(text)||!germanyEvidence(text))continue;
        const full=/remote/i.test(type)&&!hybrid(type);const comp=o.compensation?.compensationTierSummary||o.compensation?.scrapeableCompensationSalarySummary||null;const j=job({id:`ashby-${cfg.board}-${hash(o.jobUrl||o.applyUrl||o.title)}`,title:o.title,company:cfg.company,location:loc,remote:full,remoteFull:full,employmentType:[o.employmentType].filter(Boolean),publishedAt:o.publishedAt||null,url:o.jobUrl||o.applyUrl,description:desc,source,salary:comp});out.push(await enrich(j));
      }
    }catch(e){console.warn(`[${source}] ${cfg.board}: ${e.message}`);}
  }
  return out;
}

const WORKABLE=[
  {account:'shiftmove',company:'Shiftmove'},
  {account:'euronet-payments-infrastructure',company:'Euronet – Payments Infrastructure Segment'},
  {account:'1global',company:'1GLOBAL'}
];
async function workable(){
  const source='Workable öffentlich',out=[];
  for(const cfg of WORKABLE){
    try{
      const d=await get(`https://www.workable.com/api/accounts/${encodeURIComponent(cfg.account)}?details=true`);
      for(const o of d.jobs||[]){
        const loc=clean([o.city,o.state,o.country].filter(Boolean).join(', '));const desc=o.description||o.full_description||'';const text=`${o.title||''} ${loc} ${o.department||''} ${desc}`;
        if(excluded(text)||!officeLike(text)||!germanyEvidence(text))continue;
        const full=o.telecommuting===true&&!hybrid(text);const url=o.url||o.application_url||`https://apply.workable.com/${cfg.account}/j/${o.shortcode||o.code||''}`;const j=job({id:`workable-${cfg.account}-${o.shortcode||o.code||hash(url)}`,title:o.title,company:cfg.company,location:loc,remote:full,remoteFull:full,employmentType:[o.employment_type].filter(Boolean),publishedAt:o.published_on||null,url,description:desc,source});out.push(await enrich(j));
      }
    }catch(e){console.warn(`[${source}] ${cfg.account}: ${e.message}`);}
  }
  return out;
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));
  try{geoCache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{geoCache={};}
  payload.jobs=Array.isArray(payload.jobs)?payload.jobs:[];payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  const sources=[['Remote OK',remoteOk],['Greenhouse öffentlich',greenhouse],['Lever öffentlich',lever],['Ashby öffentlich',ashby],['Workable öffentlich',workable]];
  let allAdded=0,allMerged=0;
  for(const [name,fn] of sources){let jobs=[];let status='ok',note='';try{jobs=await fn();}catch(e){status='error';note=e.message;}let added=0,merged=0;for(const j of jobs){if(!j.title||!j.company||!j.url)continue;const r=merge(payload.jobs,j);r==='added'?added++:merged++;}allAdded+=added;allMerged+=merged;const entry={name,count:jobs.length,status};if(note)entry.note=note;const old=payload.meta.sources.find(x=>x.name===name);if(old)Object.assign(old,entry);else payload.meta.sources.push(entry);console.log(`[${name}] ${jobs.length} brauchbar, ${added} neu, ${merged} zusammengeführt`);}
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;payload.meta.noKeyPublicSources=true;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');await fs.writeFile(CACHE,JSON.stringify(geoCache,null,2)+'\n');
  console.log(`No-Key-Quellen: ${allAdded} neue, ${allMerged} zusammengeführt.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
