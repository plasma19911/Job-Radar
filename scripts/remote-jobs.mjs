import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT='public/data/jobs.json';
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const strip=v=>clean(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' '));
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß]+/g,' ').replace(/\s+/g,' ').trim();
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);
const companyNorm=v=>norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|ev|co|gruppe|group)\b/g,' ').replace(/\s+/g,' ').trim();
const training=j=>/(ausbildung|ausbildungsplatz|auszubild|azubi|lehrstelle|duales studium|dual studium|dualstudent|berufsausbildung)/i.test(norm(`${j.title||''} ${(j.employmentType||[]).join?.(' ')||''}`));
const pureRemoteText=v=>{
  const t=norm(v);
  if(/hybrid|teilweise remote|teilweise homeoffice|anteilig homeoffice|mobiles arbeiten.*tage|homeoffice.*tage|remote.*tage/.test(t))return false;
  return /100 prozent remote|100% remote|fully remote|full remote|komplett remote|voll remote|vollstandig remote|vollständig remote|100 prozent homeoffice|100% homeoffice|reines homeoffice|vollstandig im homeoffice|vollständig im homeoffice|ortsunabhangig|ortsunabhängig/.test(t);
};
async function get(url,{json=false,tries=3}={}){let last;for(let i=0;i<tries;i++){try{const c=new AbortController();const t=setTimeout(()=>c.abort(),25000);const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9'},signal:c.signal});clearTimeout(t);if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return json?await r.json():await r.text();}catch(e){last=e;if(i<tries-1)await sleep(700*(i+1));}}throw last;}
function final(o){const url=o.url;return{id:`remote-${o.slug||hash(url||o.title)}`,title:clean(o.title),company:clean(o.company_name),location:clean(o.location||'Deutschland / Remote'),address:'',lat:null,lon:null,remote:true,remoteFull:true,employmentType:Array.isArray(o.job_types)?o.job_types.map(clean):[],publishedAt:o.created_at?new Date(Number(o.created_at)*1000).toISOString():null,validThrough:null,url,source:'Arbeitnow',sources:[{name:'Arbeitnow',url}],description:strip(o.description).slice(0,6500),salary:null};}
function same(a,b){const at=norm(a.title),bt=norm(b.title);if(!at||!bt)return false;const ac=companyNorm(a.company),bc=companyNorm(b.company);return at===bt&&ac&&bc&&ac===bc;}
async function main(){const payload=JSON.parse(await fs.readFile(OUT,'utf8'));const incoming=[];for(let page=1;page<=18;page++){const u=new URL('https://www.arbeitnow.com/api/job-board-api');u.searchParams.set('page',String(page));let d;try{d=await get(u,{json:true,tries:2});}catch(e){console.warn(`Arbeitnow remote page ${page}: ${e.message}`);break;}const rows=d.data||[];if(!rows.length)break;for(const o of rows){const text=`${o.title||''} ${o.description||''} ${(o.job_types||[]).join(' ')}`;const isPure=o.remote===true||pureRemoteText(text);if(!isPure)continue;const j=final(o);if(training(j))continue;incoming.push(j);}if(rows.length<10)break;await sleep(140);}let added=0,merged=0;for(const j of incoming){const hit=payload.jobs.find(x=>same(x,j));if(hit){hit.remote=true;hit.remoteFull=true;merged++;if(!hit.sources?.some(s=>s.url===j.url))hit.sources=[...(hit.sources||[]),...j.sources];continue;}payload.jobs.push(j);added++;}payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;payload.meta.remoteFull=payload.jobs.filter(j=>j.remoteFull===true).length;payload.meta.trainingOffers=false;payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];const s=payload.meta.sources.find(x=>x.name==='Arbeitnow Remote');if(s){s.count=incoming.length;s.status='ok';}else payload.meta.sources.push({name:'Arbeitnow Remote',count:incoming.length,status:'ok'});await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');console.log(`Remote supplement: ${incoming.length} pure remote found, ${added} added, ${merged} merged.`);}
main().catch(e=>{console.error(e);process.exit(1);});
