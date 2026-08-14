import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT='public/data/jobs.json';
const CACHE='data/geocode-cache.json';
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const strip=v=>clean(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'"));
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß]+/g,' ').replace(/\s+/g,' ').trim();
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);
const companyNorm=v=>norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group)\b/g,' ').replace(/\s+/g,' ').trim();
const excluded=v=>/(ausbildung|ausbildungsplatz|auszubild|azubi|lehrstelle|duales studium|dual studium|dualstudent|berufsausbildung|werkstudent|werkstudentin|working student|praktikum|praktikant|praktikantin|praktikumsplatz|internship|\bintern\b)/i.test(norm(v));
const officeTitle=v=>/(sachbearbeit|büro|buero|office|verwaltung|administrat|assistenz|assistant|sekret|empfang|kundenservice|customer|support|disponent|disposition|koordination|koordinator|buchhalt|finanz|controlling|personal|hr |recruit|einkauf|vertriebsinnendienst|daten|it |digital|online|marketing|kommunikation|projekt|recht|legal|compliance|kaufmänn|kaufmaenn)/i.test(norm(v));

async function get(url,{json=false,tries=2}={}){let last;for(let i=0;i<tries;i++){try{const c=new AbortController();const t=setTimeout(()=>c.abort(),25000);const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9'},signal:c.signal,redirect:'follow'});clearTimeout(t);if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return json?await r.json():await r.text();}catch(e){last=e;if(i<tries-1)await sleep(700*(i+1));}}throw last;}
function same(a,b){return norm(a.title)===norm(b.title)&&companyNorm(a.company)&&companyNorm(a.company)===companyNorm(b.company);}
function merge(base,j){const h=base.find(x=>same(x,j));if(!h){base.push(j);return'added';}h.sources=Array.isArray(h.sources)?h.sources:[];if(!h.sources.some(s=>s.url===j.url))h.sources.push({name:j.source,url:j.url});if(!h.lat&&j.lat){h.lat=j.lat;h.lon=j.lon;}return'merged';}
let cache={};
async function geocode(q){const key=`extra:${norm(q)}`;if(Object.hasOwn(cache,key))return cache[key];try{await sleep(1050);const u=new URL('https://nominatim.openstreetmap.org/search');for(const[k,v]of Object.entries({format:'jsonv2',limit:'1',countrycodes:'de',q}))u.searchParams.set(k,v);const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'de-DE'}});if(!r.ok)throw new Error(String(r.status));const d=await r.json();cache[key]=d[0]?{lat:+d[0].lat,lon:+d[0].lon,display_name:d[0].display_name}:null;return cache[key];}catch{cache[key]=null;return null;}}
function final(o){return{id:o.id||hash(o.url||`${o.title}|${o.company}`),title:clean(o.title),company:clean(o.company),location:clean(o.location),address:clean(o.address),lat:Number.isFinite(Number(o.lat))?Number(o.lat):null,lon:Number.isFinite(Number(o.lon))?Number(o.lon):null,remote:Boolean(o.remote),remoteFull:Boolean(o.remoteFull),employmentType:Array.isArray(o.employmentType)?o.employmentType.filter(Boolean).map(clean):[clean(o.employmentType)].filter(Boolean),publishedAt:o.publishedAt?new Date(o.publishedAt).toISOString():null,validThrough:null,url:o.url,source:o.source,sources:[{name:o.source,url:o.url}],description:strip(o.description).slice(0,6500),salary:o.salary||null};}

async function jobicy(){
  const name='Jobicy Remote',jobs=[];
  for(const geo of ['germany','europe']){try{const u=new URL('https://jobicy.com/api/v2/remote-jobs');u.searchParams.set('count','100');u.searchParams.set('geo',geo);const d=await get(u,{json:true});for(const o of d.jobs||[]){const type=Array.isArray(o.jobType)?o.jobType.join(' '):o.jobType||'';if(excluded(`${o.jobTitle} ${type}`))continue;jobs.push(final({id:`jobicy-${o.id}`,title:o.jobTitle,company:o.companyName,location:o.jobGeo||'Remote',remote:true,remoteFull:true,employmentType:o.jobType||[],publishedAt:o.pubDate,url:o.url,description:o.jobDescription||o.jobExcerpt,source:name,salary:o.salaryMin||o.salaryMax?`${o.salaryMin||''}-${o.salaryMax||''} ${o.salaryCurrency||''} ${o.salaryPeriod||''}`:null}));}}catch(e){console.warn(`[${name}] ${geo}: ${e.message}`);}}
  return [...new Map(jobs.map(j=>[j.url,j])).values()];
}

async function remotive(){
  const name='Remotive',jobs=[];try{const d=await get('https://remotive.com/api/remote-jobs',{json:true});for(const o of d.jobs||[]){const loc=norm(o.candidate_required_location||'');if(loc&&!/(germany|deutschland|europe|emea|worldwide|anywhere|global)/.test(loc))continue;if(excluded(`${o.title} ${o.job_type||''}`))continue;jobs.push(final({id:`remotive-${o.id}`,title:o.title,company:o.company_name,location:o.candidate_required_location||'Remote',remote:true,remoteFull:true,employmentType:o.job_type||[],publishedAt:o.publication_date,url:o.url,description:o.description,source:name,salary:o.salary||null}));}}catch(e){console.warn(`[${name}] ${e.message}`);}return jobs;
}

function berlinCandidates(html,base){const out=[];const re=/<a[^>]+href=["']([^"']*-de-j\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;while((m=re.exec(html))){try{const url=new URL(m[1],base).href,title=strip(m[2]);if(title&&officeTitle(title)&&!excluded(title))out.push({url,title});}catch{}}return out;}
async function berlinPortal(){
  const name='Land Berlin Karriereportal',candidates=[];
  for(let start=0;start<240;start+=20){const u=`https://www.karriereportal-stellen.berlin.de/stellenangebote.html?start=${start}`;try{candidates.push(...berlinCandidates(await get(u),u));}catch(e){console.warn(`[${name}] Liste ${start}: ${e.message}`);break;}await sleep(120);}
  const uniq=[...new Map(candidates.map(x=>[x.url,x])).values()].slice(0,90),jobs=[];
  for(const c of uniq){try{const html=await get(c.url),text=strip(html),title=strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||c.title);if(excluded(title))continue;const company=strip(html.match(/<h1[^>]*>[\s\S]*?<\/h1>[\s\S]*?<li[^>]*>([\s\S]*?)<\/li>/i)?.[1]||'Land Berlin');const addr=text.match(/\b(\d{5}\s+Berlin)\s*,\s*([^|]{3,90}?)(?=\s+(?:Monatsgehalt|Kennziffer|Bewerbungsfrist|Besoldungsgruppe|Entgeltgruppe|Arbeitszeit|$))/i)||text.match(/Einsatzort:\s*([^|]{3,120}?\b\d{5}\s+Berlin)/i);let address='';if(addr){address=addr[0].replace(/^Einsatzort:\s*/i,'').replace(/Monatsgehalt.*$/i,'').trim();if(/^\d{5}\s+Berlin\s*,/i.test(address)){const mm=address.match(/^(\d{5}\s+Berlin)\s*,\s*(.+)$/i);if(mm)address=`${mm[2]}, ${mm[1]}`;}}if(!address)continue;const g=await geocode(address);if(!g)continue;const date=text.match(/Veröffentlicht\s*:?\s*(\d{2}\.\d{2}\.\d{4})/i)?.[1];let publishedAt=null;if(date){const[d,m,y]=date.split('.');publishedAt=new Date(`${y}-${m}-${d}T12:00:00Z`).toISOString();}jobs.push(final({id:`berlin-${hash(c.url)}`,title,company,location:'Berlin',address:g.display_name,lat:g.lat,lon:g.lon,remote:false,remoteFull:false,employmentType:[],publishedAt,url:c.url,description:text,source:name}));}catch{} }
  return jobs;
}

async function main(){const payload=JSON.parse(await fs.readFile(OUT,'utf8'));try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];let added=0,merged=0;for(const [name,fn] of [['Jobicy Remote',jobicy],['Remotive',remotive],['Land Berlin Karriereportal',berlinPortal]]){const jobs=await fn();console.log(`[${name}] ${jobs.length}`);for(const j of jobs){const r=merge(payload.jobs,j);r==='added'?added++:merged++;}const s=payload.meta.sources.find(x=>x.name===name);if(s){s.count=jobs.length;s.status='ok';}else payload.meta.sources.push({name,count:jobs.length,status:'ok'});}payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');console.log(`Extra-Quellen: ${added} neue, ${merged} zusammengeführt.`);}
main().catch(e=>{console.error(e);process.exit(1);});
