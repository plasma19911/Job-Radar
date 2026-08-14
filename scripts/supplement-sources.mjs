import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT='public/data/jobs.json';
const CACHE='data/geocode-cache.json';
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const strip=v=>clean(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>'));
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(m|w|d|gn|divers)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const companyNorm=v=>norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|ev|co|gruppe|group)\b/g,' ').replace(/\s+/g,' ').trim();
const num=v=>(v===null||v===undefined||v==='')?null:(Number.isFinite(Number(v))?Number(v):null);
const isTraining=j=>/(ausbildung|ausbildungsplatz|auszubild|azubi|lehrstelle|duales studium|dual studium|dualstudent|berufsausbildung)/i.test(norm(`${j.title||''} ${(j.employmentType||[]).join?.(' ')||''}`));
const inRegion=(lat,lon)=>Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=51.30&&lat<=53.70&&lon>=11.10&&lon<=14.90;

async function get(url,{json=false,headers={},tries=3}={}){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const c=new AbortController(); const t=setTimeout(()=>c.abort(),25000);
      const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9',...headers},signal:c.signal,redirect:'follow'}); clearTimeout(t);
      if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return json?await r.json():await r.text();
    }catch(e){last=e;if(i<tries-1)await sleep(700*(i+1));}
  }
  throw last;
}
function source(name,url){return{name,url};}
function final(j){
  const sources=(j.sources||[source(j.source,j.url)]).filter(s=>s?.url);
  return {id:j.id||hash(`${norm(j.title)}|${companyNorm(j.company)}|${norm(j.location)}|${j.url}`),title:clean(j.title),company:clean(j.company),location:clean(j.location),address:clean(j.address),lat:num(j.lat),lon:num(j.lon),remote:Boolean(j.remote),employmentType:Array.isArray(j.employmentType)?j.employmentType.filter(Boolean).map(clean):[],publishedAt:j.publishedAt?new Date(j.publishedAt).toISOString():null,validThrough:null,url:j.url,source:j.source,sources,description:strip(j.description).slice(0,6500),salary:null};
}

async function bundesagentur(){
  const name='Bundesagentur für Arbeit', jobs=[];
  const endpoint='https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/app/jobs';
  const places=['Berlin','Potsdam','Cottbus','Frankfurt (Oder)','Brandenburg an der Havel','Oranienburg','Eberswalde','Königs Wusterhausen'];
  for(const wo of places){
    for(let page=1;page<=4;page++){
      const u=new URL(endpoint);
      for(const [k,v] of Object.entries({angebotsart:'1',wo,umkreis:'50',veroeffentlichtseit:'35',page:String(page),size:'100',pav:'false'}))u.searchParams.set(k,v);
      let data;try{data=await get(u,{json:true,headers:{'X-API-Key':'jobboerse-jobsuche'}});}catch(e){console.warn(`[BA] ${wo}/${page}: ${e.message}`);break;}
      const rows=data.stellenangebote||data.jobs||[]; if(!rows.length)break;
      for(const o of rows){
        const w=o.arbeitsort||o.arbeitsorte?.[0]||{}; const c=w.koordinaten||o.koordinaten||{}; const ref=o.refnr||o.referenznummer||o.hashId;
        const url=o.externeUrl||o.externeURL||(ref?`https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(ref)}`:'https://www.arbeitsagentur.de/jobsuche/');
        jobs.push(final({id:ref?`ba-${hash(ref)}`:null,title:o.beruf||o.titel||o.stellenangebotsTitel,company:o.arbeitgeber||o.arbeitgeberName,location:clean([w.plz,w.ort].filter(Boolean).join(' '))||wo,address:clean([w.strasse,w.plz,w.ort].filter(Boolean).join(', ')),lat:c.lat,lon:c.lon,employmentType:o.arbeitszeitmodelle||o.arbeitszeit||[],publishedAt:o.aktuelleVeroeffentlichungsdatum||o.aktuelleVeroeffentlichungsDatum||o.veroeffentlichtAm||o.ersteVeroeffentlichungsdatum,url,source:name,sources:[source(name,url)]}));
      }
      if(rows.length<100)break; await sleep(130);
    }
  }
  return jobs.filter(j=>j.title&&!isTraining(j));
}

function links(html,base){
  const out=[]; const re=/\bhref\s*=\s*["']([^"'#]+)["']/gi; let m;
  while((m=re.exec(html))){try{const u=new URL(m[1].replace(/&amp;/g,'&'),base);if(u.hostname==='jobs.tagesspiegel.de'&&/^\/job\//i.test(u.pathname)&&/\.html$/i.test(u.pathname))out.push(u.href.split('#')[0]);}catch{}}
  return [...new Set(out)];
}
function germanDate(v){const m=String(v||'').match(/(\d{2})\.(\d{2})\.(\d{4})/);return m?new Date(Date.UTC(+m[3],+m[2]-1,+m[1],12)).toISOString():null;}
function parseTagesspiegel(html,url){
  const h1=html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); const og=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i); const tt=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title=strip(h1?.[1]||og?.[1]||tt?.[1]||'').replace(/\s*[|–-]\s*Tagesspiegel.*$/i,''); if(!title||isTraining({title,employmentType:[]}))return null;
  const text=strip(html), start=text.indexOf('Informationen zur Anzeige:'); if(start<0)return null;
  const seg=text.slice(start,start+10000), dm=seg.match(/Aktualität:\s*(\d{2}\.\d{2}\.\d{4})/i); const before=(dm?seg.slice(0,dm.index):seg.slice(0,1100)).replace(/^.*?Informationen zur Anzeige:\s*/i,'').trim();
  const locs=[...before.matchAll(/\b(Berlin(?:-[A-Za-zÄÖÜäöüß-]+)?|Potsdam|Cottbus|Frankfurt\s*\(Oder\)|Brandenburg an der Havel|Oranienburg|Eberswalde|Wildau|Hennigsdorf|Wustermark|Mühlenbecker Land|Hoppegarten|Königs Wusterhausen|Falkensee|Strausberg|Fürstenwalde|Neuruppin|Schwedt)\b/gi)];
  const lm=locs.at(-1), location=lm?.[1]||'Berlin'; let company=''; const p=before.toLowerCase().indexOf(title.toLowerCase()); const tail=p>=0?before.slice(p+title.length).trim():before; const lp=tail.toLowerCase().lastIndexOf(location.toLowerCase()); if(lp>0)company=tail.slice(0,lp).trim();
  const bodyPos=seg.search(/Anzeigeninhalt:/i); let description=bodyPos>=0?seg.slice(bodyPos).replace(/^.*?Anzeigeninhalt:\s*/i,''):''; description=description.split(/\bBerufsfeld\b/i)[0].trim();
  return final({title,company,location,publishedAt:germanDate(dm?.[1]),url,description,source:'Tagesspiegel Jobs',sources:[source('Tagesspiegel Jobs',url)]});
}
async function tagesspiegel(){
  const pages=['https://jobs.tagesspiegel.de/stellenangebote/berlin','https://jobs.tagesspiegel.de/neue-angebote']; let urls=[];
  for(const p of pages){try{urls.push(...links(await get(p),p));}catch(e){console.warn(`[Tagesspiegel] Liste: ${e.message}`);}}
  urls=[...new Set(urls)].slice(0,80); const jobs=[];
  for(let i=0;i<urls.length;i+=5){
    const batch=await Promise.all(urls.slice(i,i+5).map(async u=>{try{return parseTagesspiegel(await get(u,{tries:2}),u);}catch{return null;}})); jobs.push(...batch.filter(Boolean)); await sleep(180);
  }
  return jobs;
}

let cache={};
async function geocode(job){
  if(inRegion(job.lat,job.lon)||!job.location)return;
  const key=norm(`${job.location}, Deutschland`); if(Object.hasOwn(cache,key)){const h=cache[key];if(h){job.lat=h.lat;job.lon=h.lon;}return;}
  try{await sleep(1100);const u=new URL('https://nominatim.openstreetmap.org/search');for(const[k,v]of Object.entries({format:'jsonv2',limit:'1',countrycodes:'de',q:`${job.location}, Deutschland`}))u.searchParams.set(k,v);const d=await get(u,{json:true,tries:2});const h=d[0]?{lat:+d[0].lat,lon:+d[0].lon,display_name:d[0].display_name}:null;cache[key]=h;if(h&&inRegion(h.lat,h.lon)){job.lat=h.lat;job.lon=h.lon;}}catch{cache[key]=null;}
}
function same(a,b){
  const at=norm(a.title),bt=norm(b.title); if(!at||!bt)return false;
  const exact=at===bt; const A=new Set(at.split(' ').filter(x=>x.length>2)),B=new Set(bt.split(' ').filter(x=>x.length>2));let inter=0;for(const x of A)if(B.has(x))inter++;const sim=inter/Math.max(A.size||1,B.size||1);
  const ac=companyNorm(a.company),bc=companyNorm(b.company), al=norm(a.location),bl=norm(b.location);
  return (exact||sim>=.82)&&((ac&&bc&&ac===bc)||(al&&bl&&(al.includes(bl)||bl.includes(al))));
}
function mergeInto(base,extra){let merged=0;for(const j of extra){const hit=base.find(x=>same(x,j));if(hit){merged++;const seen=new Set((hit.sources||[]).map(s=>s.url));for(const s of j.sources||[])if(!seen.has(s.url))hit.sources.push(s);if(!hit.lat&&j.lat){hit.lat=j.lat;hit.lon=j.lon;}if((j.description||'').length>(hit.description||'').length)hit.description=j.description;continue;}base.push(j);}return merged;}
function setStat(meta,name,count,status='ok'){meta.sources=Array.isArray(meta.sources)?meta.sources:[];const s=meta.sources.find(x=>x.name===name);if(s){s.count=count;s.status=status;delete s.error;}else meta.sources.push({name,count,status});}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8')); try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}
  const ba=await bundesagentur(); console.log(`[Bundesagentur für Arbeit supplement] ${ba.length}`);
  const ts=await tagesspiegel(); console.log(`[Tagesspiegel Jobs supplement] ${ts.length}`);
  const uniqueLoc=new Map();for(const j of ts)if(j.location&&!inRegion(j.lat,j.lon))uniqueLoc.set(norm(j.location),j);for(const j of uniqueLoc.values())await geocode(j);for(const j of ts){const ref=uniqueLoc.get(norm(j.location));if(ref?.lat){j.lat=ref.lat;j.lon=ref.lon;}}
  const before=payload.jobs.length; const merged=mergeInto(payload.jobs,[...ba,...ts].filter(j=>!isTraining(j))); payload.jobs.sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0));
  payload.meta.generatedAt=new Date().toISOString(); payload.meta.total=payload.jobs.length; payload.meta.mapped=payload.jobs.filter(j=>inRegion(j.lat,j.lon)).length; payload.meta.deduplicated=(payload.meta.deduplicated||0)+merged; payload.meta.trainingOffers=false; setStat(payload.meta,'Bundesagentur für Arbeit',ba.length); setStat(payload.meta,'Tagesspiegel Jobs',ts.length);
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n'); await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');
  console.log(`Supplement done: +${payload.jobs.length-before} unique, ${merged} merged, total ${payload.jobs.length}.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
