import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT='public/data/jobs.json';
const SOURCE='Himalayas Remote';
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const TERMS=['Sachbearbeiter','Administration','Customer Support','Customer Service','Backoffice','Accounting','Finance','HR','Recruiting','Operations','Project Coordinator','IT Support','Office Manager'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß]+/g,' ').replace(/\s+/g,' ').trim();
const strip=v=>clean(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'"));
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);
const excluded=v=>/(senior|\bsr\b|ausbildung|auszubild|azubi|duales studium|werkstudent|working student|praktikum|internship|\bintern\b)/i.test(norm(v));
const officeLike=v=>/(sachbearbeit|administrat|customer|support|backoffice|account|finance|buchhalt|\bhr\b|human resources|recruit|operations|project|coordinator|office|it support|service desk|assist|sekret|payroll|procurement|einkauf|legal|compliance|data|daten)/i.test(norm(v));

async function request(url){const c=new AbortController();const t=setTimeout(()=>c.abort(),22000);try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9,en;q=0.5'},signal:c.signal});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.json();}finally{clearTimeout(t);}}
function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland)\b/g,' ').replace(/\s+/g,' ').trim();}
function same(a,b){return norm(a.title)===norm(b.title)&&companyNorm(a.company)&&companyNorm(a.company)===companyNorm(b.company);}
function merge(base,j){const hit=base.find(x=>same(x,j));if(!hit){base.push(j);return'added';}hit.sources=Array.isArray(hit.sources)?hit.sources:[];if(!hit.sources.some(s=>s.url===j.url))hit.sources.push({name:SOURCE,url:j.url});if(!hit.salary&&j.salary)hit.salary=j.salary;if((j.description||'').length>(hit.description||'').length)hit.description=j.description;if(j.remoteFull===true){hit.remote=true;hit.remoteFull=true;}return'merged';}
function date(v){if(!v)return null;const d=typeof v==='number'?new Date(v):new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString();}
function locationText(o){const r=Array.isArray(o.locationRestrictions)?o.locationRestrictions:[];return r.map(x=>x?.name||x?.slug||x?.alpha2).filter(Boolean).join(', ')||'Deutschland / Remote';}
function salary(o){if(o.minSalary==null&&o.maxSalary==null)return null;return `${o.minSalary??''}-${o.maxSalary??''} ${o.currency||''} ${o.salaryPeriod||''}`.trim();}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));payload.jobs=Array.isArray(payload.jobs)?payload.jobs:[];payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  const seen=new Set();const incoming=[];
  for(const q of TERMS){
    for(let page=1;page<=2;page++){
      const u=new URL('https://himalayas.app/jobs/api/search');u.searchParams.set('q',q);u.searchParams.set('country','Germany');u.searchParams.set('exclude_worldwide','true');u.searchParams.set('sort','recent');u.searchParams.set('page',String(page));
      let d;try{d=await request(u);}catch(e){console.warn(`[${SOURCE}] ${q} S.${page}: ${e.message}`);break;}
      const rows=d.jobs||[];if(!rows.length)break;
      for(const o of rows){const url=o.applicationLink;if(!url||seen.has(o.guid||url))continue;seen.add(o.guid||url);const text=`${o.title||''} ${o.excerpt||''} ${o.description||''} ${(o.categories||[]).join(' ')}`;if(excluded(text)||!officeLike(text))continue;const loc=locationText(o);if(!/(germany|deutschland|\bde\b)/i.test(loc))continue;incoming.push({id:`himalayas-${hash(o.guid||url)}`,title:clean(o.title),company:clean(o.companyName),location:loc,address:'',lat:null,lon:null,remote:true,remoteFull:true,employmentType:[o.employmentType].filter(Boolean),publishedAt:date(o.pubDate),validThrough:date(o.expiryDate),url,source:SOURCE,sources:[{name:SOURCE,url}],description:strip(o.description||o.excerpt).slice(0,6500),salary:salary(o)});}
      await sleep(220);
    }
  }
  let added=0,merged=0;for(const j of incoming){const r=merge(payload.jobs,j);r==='added'?added++:merged++;}
  const entry={name:SOURCE,count:incoming.length,status:'ok'};const old=payload.meta.sources.find(x=>x.name===SOURCE);if(old)Object.assign(old,entry);else payload.meta.sources.push(entry);
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');console.log(`[${SOURCE}] ${incoming.length} brauchbar, ${added} neu, ${merged} zusammengeführt`);
}
main().catch(e=>{console.error(e);process.exit(1);});
