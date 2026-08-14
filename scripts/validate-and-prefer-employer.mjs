import fs from 'node:fs/promises';

const OUT='public/data/jobs.json';
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const NOW=Date.now();
const OLD_AFTER_MS=24*60*60*1000;
const CONCURRENCY=8;
const TIMEOUT_MS=12000;

const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß]+/g,' ').replace(/\s+/g,' ').trim();
const decode=s=>String(s||'').replace(/&quot;|&#34;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&nbsp;/gi,' ');
const stripHtml=s=>clean(decode(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')));

const AGGREGATOR_HOST_RE=/(^|\.)(stepstone\.de|indeed\.com|xing\.com|linkedin\.com|monster\.de|jobware\.de|meinestadt\.de|stellenanzeigen\.de|jooble\.org|glassdoor\.de|talent\.com|arbeitnow\.com|jobicy\.com|remotive\.com|adzuna\.[a-z.]+|arbeitsagentur\.de|jobs\.tagesspiegel\.de|jobs\.morgenpost\.de|maz-job\.de|bluum\.de|berliner-jobmarkt\.de)$/i;
const ATS_HOST_RE=/(^|\.)(softgarden\.io|personio\.de|personio\.com|workdayjobs\.com|myworkdayjobs\.com|smartrecruiters\.com|join\.com|recruitee\.com|onlyfy\.io|successfactors\.eu|successfactors\.com|umantis\.com)$/i;
const CLOSED_RE=/(stelle|stellenanzeige|stellenangebot|position|job|vacancy).{0,80}(nicht mehr verfugbar|nicht mehr verfügbar|nicht verfugbar|nicht verfügbar|bereits besetzt|wurde besetzt|wurde entfernt|abgelaufen|geschlossen|no longer available|no longer exists|has been filled|has expired|is closed)|leider.{0,80}(stelle|position|job).{0,80}(nicht mehr|besetzt|verfugbar|verfügbar)/i;

function safeUrl(v){try{const u=new URL(v);return /^https?:$/.test(u.protocol)?u:null;}catch{return null;}}
function host(v){const u=safeUrl(v);return u?u.hostname.toLowerCase().replace(/^www\./,''):'';}
function isAggregatorUrl(v){const h=host(v);return !h||AGGREGATOR_HOST_RE.test(h);}
function isAtsUrl(v){const h=host(v);return ATS_HOST_RE.test(h);}
function isDirectSource(s){
  if(!s?.url)return false;
  if(/direkt|karriere|career|arbeitgeber/i.test(s.name||''))return true;
  return !isAggregatorUrl(s.url);
}
function sourceScore(s){
  let n=0;
  if(/direkt/i.test(s.name||''))n+=5;
  if(isAtsUrl(s.url))n+=3;
  if(!isAggregatorUrl(s.url))n+=2;
  return n;
}
function titleTokens(v=''){return new Set(norm(v).split(' ').filter(x=>x.length>2&&!['der','die','das','und','fur','als','mit','bei','von','mwd','mwdgn'].includes(x)));}
function similarity(a,b){const A=titleTokens(a),B=titleTokens(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size);}
function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland)\b/g,' ').replace(/\s+/g,' ').trim();}
function sameCompany(a,b){const A=companyNorm(a),B=companyNorm(b);return !A||!B||A===B||A.includes(B)||B.includes(A);}
function oldEnough(j){
  const t=new Date(j.firstSeenAt||j.publishedAt||0).getTime();
  return !Number.isFinite(t)||t<=0||NOW-t>=OLD_AFTER_MS;
}
function expired(v){
  if(!v)return false;
  const t=new Date(v).getTime();
  return Number.isFinite(t)&&t<NOW;
}

async function get(url){
  const c=new AbortController();const timer=setTimeout(()=>c.abort(),TIMEOUT_MS);
  try{
    const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9,en;q=0.5','Accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:c.signal});
    const html=(r.status===403||r.status===429||r.status>=500)?'':await r.text();
    return {status:r.status,url:r.url||url,html};
  }catch(e){return {status:0,url,error:e?.name==='AbortError'?'timeout':clean(e?.message)};}
  finally{clearTimeout(timer);}
}
function jsonLd(html){
  const out=[];const re=/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;
  while((m=re.exec(html||''))){for(const raw of [m[1],decode(m[1])]){try{walk(JSON.parse(raw),out);break;}catch{}}}
  return out;
}
function walk(x,out){
  if(Array.isArray(x)){for(const y of x)walk(y,out);return;}
  if(!x||typeof x!=='object')return;
  const t=x['@type'];if(t==='JobPosting'||(Array.isArray(t)&&t.includes('JobPosting')))out.push(x);
  for(const k of ['@graph','itemListElement','mainEntity'])if(x[k])walk(x[k],out);
}
function pageState(res,job){
  if([404,410].includes(res.status))return {state:'dead',reason:`HTTP ${res.status}`};
  if(res.status===403||res.status===429||res.status>=500||res.status===0)return {state:'unknown',reason:res.status?`HTTP ${res.status}`:(res.error||'Netzwerkfehler')};
  if(res.status<200||res.status>=400)return {state:'unknown',reason:`HTTP ${res.status}`};
  const text=stripHtml(res.html).slice(0,120000);
  if(CLOSED_RE.test(norm(text)))return {state:'dead',reason:'Seite meldet Stelle als nicht mehr verfügbar'};
  const postings=jsonLd(res.html);
  const matching=postings.filter(ld=>!ld.title||similarity(ld.title,job.title)>=0.45);
  if(matching.some(ld=>expired(ld.validThrough)))return {state:'dead',reason:'validThrough abgelaufen'};
  return {state:'alive',reason:'erreichbar'};
}
function uniqSources(j){
  const a=[{name:j.source||'Quelle',url:j.url},...(Array.isArray(j.sources)?j.sources:[])].filter(x=>x?.url);
  const seen=new Set();return a.filter(x=>{const k=x.url.replace(/#.*$/,'');if(seen.has(k))return false;seen.add(k);return true;});
}
function preferExistingDirect(j){
  const direct=uniqSources(j).filter(isDirectSource).sort((a,b)=>sourceScore(b)-sourceScore(a));
  if(!direct.length)return false;
  const s=direct[0];
  if(j.url!==s.url||j.source!==s.name){j.url=s.url;j.source=s.name;}
  j.officialEmployerSource=true;
  j.primarySourceType='employer';
  return true;
}
function anchorLinks(html,base){
  const out=[];const re=/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(html||''))){try{const u=new URL(decode(m[1]),base);if(!/^https?:$/.test(u.protocol))continue;out.push({url:u.href.split('#')[0],text:stripHtml(m[2])});}catch{}}
  return out;
}
function officialCandidates(html,base,job){
  const out=[];
  for(const ld of jsonLd(html)){
    if(ld.title&&similarity(ld.title,job.title)<0.4)continue;
    const org=ld.hiringOrganization;
    if(org&&typeof org==='object'&&sameCompany(org.name||'',job.company)){
      for(const v of [org.sameAs,org.url])if(typeof v==='string')out.push(v);
    }
    if(typeof ld.url==='string'&&!isAggregatorUrl(ld.url))out.push(ld.url);
  }
  for(const a of anchorLinks(html,base)){
    if(isAggregatorUrl(a.url))continue;
    const score=(/(karriere|career|jobs|stellen|arbeitgeber|unternehmen|website)/i.test(`${a.text} ${a.url}`)?2:0)+(companyNorm(a.text)&&sameCompany(a.text,job.company)?2:0);
    if(score>=2)out.push(a.url);
  }
  return [...new Set(out)].filter(x=>safeUrl(x)&&!isAggregatorUrl(x)).slice(0,6);
}
function careerLinks(html,base){
  return anchorLinks(html,base)
    .filter(a=>/(karriere|career|jobs|stellenangebote|stellen|vacancies|join-us|work-with-us)/i.test(`${a.text} ${a.url}`))
    .map(a=>a.url).filter(x=>!isAggregatorUrl(x)).filter((x,i,a)=>a.indexOf(x)===i).slice(0,5);
}
function matchingDirectJob(html,url,job){
  const postings=jsonLd(html);
  for(const ld of postings){
    const org=typeof ld.hiringOrganization==='object'?ld.hiringOrganization?.name:ld.hiringOrganization;
    if(ld.title&&similarity(ld.title,job.title)>=0.62&&sameCompany(org||job.company,job.company)){
      const u=typeof ld.url==='string'?new URL(ld.url,url).href:url;
      return !isAggregatorUrl(u)?u:null;
    }
  }
  const text=stripHtml(html).slice(0,120000);
  if(similarity(text.slice(0,500),job.title)>=0.4&&norm(text).includes(norm(job.company).split(' ')[0]||'___'))return url;
  return null;
}
async function discoverOfficial(job){
  if(preferExistingDirect(job))return true;
  const starts=uniqSources(job).filter(s=>isAggregatorUrl(s.url)).slice(0,3);
  for(const s of starts){
    const portal=await get(s.url);
    if(portal.status!==200)continue;
    const candidates=officialCandidates(portal.html,portal.url,job);
    for(const candidate of candidates){
      const first=await get(candidate);
      if(first.status!==200)continue;
      const direct=matchingDirectJob(first.html,first.url,job);
      if(direct){setOfficial(job,direct);return true;}
      for(const c of careerLinks(first.html,first.url).slice(0,3)){
        const page=await get(c);if(page.status!==200)continue;
        const found=matchingDirectJob(page.html,page.url,job);
        if(found){setOfficial(job,found);return true;}
        const jobLinks=anchorLinks(page.html,page.url)
          .filter(a=>similarity(a.text,job.title)>=0.55&&!isAggregatorUrl(a.url))
          .map(a=>a.url).slice(0,3);
        for(const jl of jobLinks){
          const detail=await get(jl);if(detail.status!==200)continue;
          const d=matchingDirectJob(detail.html,detail.url,job);
          if(d){setOfficial(job,d);return true;}
        }
      }
    }
  }
  return false;
}
function setOfficial(job,url){
  const name=`${clean(job.company)||'Arbeitgeber'} direkt`;
  job.sources=Array.isArray(job.sources)?job.sources:[];
  if(!job.sources.some(s=>s.url===url))job.sources.unshift({name,url});
  job.url=url;job.source=name;job.officialEmployerSource=true;job.primarySourceType='employer';
}
async function validate(job){
  if(expired(job.validThrough))return {keep:false,reason:'validThrough abgelaufen'};
  if(!oldEnough(job))return {keep:true,skipped:true};
  const sources=uniqSources(job);
  if(!sources.length)return {keep:true,unknown:true};
  const primaryDirect=job.officialEmployerSource===true||isDirectSource(sources[0]);
  let unknown=false;
  for(let i=0;i<sources.length;i++){
    const s=sources[i],res=await get(s.url),state=pageState(res,job);
    if(i===0&&primaryDirect&&state.state==='dead')return {keep:false,reason:`Arbeitgeberquelle: ${state.reason}`};
    if(state.state==='alive'){
      job.lastAvailabilityCheckAt=new Date().toISOString();
      job.availabilityStatus='active';
      if(i>0&&!primaryDirect){job.url=s.url;job.source=s.name;}
      return {keep:true};
    }
    if(state.state==='unknown')unknown=true;
  }
  job.lastAvailabilityCheckAt=new Date().toISOString();
  job.availabilityStatus=unknown?'unknown':'inactive';
  return unknown?{keep:true,unknown:true}:{keep:false,reason:'alle erreichbaren Quellen nicht mehr verfügbar'};
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let i=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const idx=i++;if(idx>=items.length)break;out[idx]=await fn(items[idx],idx);}});
  await Promise.all(workers);return out;
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));payload.jobs=Array.isArray(payload.jobs)?payload.jobs:[];payload.meta=payload.meta||{};
  let preferredExisting=0,discovered=0;
  for(const j of payload.jobs)if(preferExistingDirect(j))preferredExisting++;
  const discoverTargets=payload.jobs.filter(j=>!j.officialEmployerSource&&oldEnough(j)).slice(0,70);
  await mapLimit(discoverTargets,4,async j=>{try{if(await discoverOfficial(j))discovered++;}catch{}});
  const checks=await mapLimit(payload.jobs,CONCURRENCY,async j=>{try{return await validate(j);}catch{return {keep:true,unknown:true};}});
  const before=payload.jobs.length;const kept=[];const removed=[];
  for(let i=0;i<payload.jobs.length;i++){if(checks[i]?.keep)kept.push(payload.jobs[i]);else removed.push({job:payload.jobs[i],reason:checks[i]?.reason||'nicht mehr verfügbar'});}
  payload.jobs=kept;
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=kept.length;
  payload.meta.localWithin10km=kept.filter(j=>j.remoteFull!==true).length;
  payload.meta.remoteFull=kept.filter(j=>j.remoteFull===true).length;
  payload.meta.availabilityCheck={checked:checks.filter(x=>x&&!x.skipped).length,removed:removed.length,unknown:checks.filter(x=>x?.unknown).length,olderThanHours:24,checkedAt:new Date().toISOString()};
  payload.meta.preferredEmployerSources={existing:preferredExisting,discovered,enabled:true};
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');
  console.log(`Gültigkeitsprüfung: ${before} -> ${kept.length}; ${removed.length} tote/abgelaufene Stellen entfernt; ${checks.filter(x=>x?.unknown).length} temporär nicht prüfbar (behalten).`);
  console.log(`Arbeitgeberquelle bevorzugt: ${preferredExisting} bereits vorhanden, ${discovered} neu gefunden.`);
  for(const r of removed.slice(0,15))console.log(`- entfernt: ${r.job.title} | ${r.job.company} | ${r.reason}`);
}
main().catch(e=>{console.error(e);process.exit(1);});
