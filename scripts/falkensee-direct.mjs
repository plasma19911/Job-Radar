import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT='public/data/jobs.json';
const CACHE='data/geocode-cache.json';
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const strip=v=>clean(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&auml;/gi,'ä').replace(/&ouml;/gi,'ö').replace(/&uuml;/gi,'ü').replace(/&szlig;/gi,'ß'));
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß]+/g,' ').replace(/\s+/g,' ').trim();
const hash=v=>crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,18);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function get(url){
  const c=new AbortController();const timer=setTimeout(()=>c.abort(),22000);
  try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9'},redirect:'follow',signal:c.signal});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();}
  finally{clearTimeout(timer);}
}
function excluded(title='',text=''){
  const t=norm(`${title} ${text}`);
  return /(ausbildung|auszubild|azubi|duales studium|dual studium|werkstudent|working student|studentische hilfskraft|praktikum|praktikant|internship|schülerpraktikum|schuelerpraktikum)/i.test(t);
}
function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland)\b/g,' ').replace(/\s+/g,' ').trim();}
function same(a,b){const ac=companyNorm(a.company),bc=companyNorm(b.company);if(!ac||!bc||ac!==bc)return false;const at=norm(a.title),bt=norm(b.title);return at===bt||(at.length>12&&bt.length>12&&(at.includes(bt)||bt.includes(at)));}
function merge(base,j){const hit=base.find(x=>same(x,j));if(!hit){base.push(j);return'added';}hit.sources=Array.isArray(hit.sources)?hit.sources:[];if(!hit.sources.some(s=>s.url===j.url))hit.sources.push({name:j.source,url:j.url});if(!hit.lat&&j.lat){hit.lat=j.lat;hit.lon=j.lon;hit.address=j.address;}return'merged';}

let cache={};
async function geocode(q){
  const key=`falkensee-direct:${norm(q)}`;if(Object.hasOwn(cache,key))return cache[key];
  try{await sleep(1100);const u=new URL('https://nominatim.openstreetmap.org/search');u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',q);const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'de-DE'}});if(!r.ok)throw new Error(String(r.status));const d=await r.json();cache[key]=d[0]?{lat:+d[0].lat,lon:+d[0].lon,display_name:d[0].display_name}:null;}catch{cache[key]=null;}return cache[key];
}
function job({title,company,location,address,geo,url,source,description,publishedAt=null}){return {id:`local-special-${hash(`${company}|${title}|${url}`)}`,title,company,location,address,lat:geo?.lat??null,lon:geo?.lon??null,remote:false,remoteFull:false,employmentType:[],publishedAt,validThrough:null,url,source,sources:[{name:source,url}],description:clean(description).slice(0,6500),salary:null};}

async function ennux(){
  const url='https://ennux.de/karriere/';
  try{
    const html=await get(url),text=strip(html);const geo=await geocode('Innsbrucker Str. 53, 14612 Falkensee');
    const titles=['Sachbearbeiter (m/w/d)','Key Account Manager (m/w/d)','Social Media Manager (m/w/d)'];
    const out=[];
    for(const title of titles){if(!norm(text).includes(norm(title))||excluded(title))continue;out.push(job({title,company:'Ennux Distribution GmbH & Co. KG',location:'Falkensee',address:geo?.display_name||'Innsbrucker Str. 53, 14612 Falkensee',geo,url,source:'Ennux Falkensee direkt',description:text}));}
    console.log(`[Ennux Falkensee direkt] ${out.length}`);return out;
  }catch(e){console.warn(`[Ennux Falkensee direkt] ${e.message}`);return[];}
}

async function lebenshilfe(){
  const url='https://www.lebenshilfe-havelland.de/blank-6';
  try{
    const html=await get(url),text=strip(html);const geo=await geocode('Bahnhofstraße 32, 14612 Falkensee');
    const candidates=['Personalsachbearbeiter (m/w/d)','Personalsachbearbeiter/in','Sachbearbeiter Personal'];const out=[];
    for(const title of candidates){if(!norm(text).includes(norm(title))||excluded(title,text))continue;out.push(job({title:'Personalsachbearbeiter (m/w/d)',company:'Lebenshilfe Havelland e.V.',location:'Falkensee',address:geo?.display_name||'Bahnhofstraße 32, 14612 Falkensee',geo,url,source:'Lebenshilfe Havelland direkt',description:text}));break;}
    console.log(`[Lebenshilfe Havelland direkt] ${out.length}`);return out;
  }catch(e){console.warn(`[Lebenshilfe Havelland direkt] ${e.message}`);return[];}
}

async function detail(url,company,source,geoQuery,location){
  try{const html=await get(url),text=strip(html);const title=strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');if(!title||excluded(title,text))return null;const geo=await geocode(geoQuery);return job({title,company,location,address:geo?.display_name||geoQuery,geo,url,source,description:text});}catch{return null;}
}
async function apleona(){
  const urls=['https://jobs.apleona.com/offer/objektleiter-w-m-d/274b3140-da98-4d14-bfa8-b2c2ce7fe063','https://jobs.apleona.com/offer/objektleiter-w-m-d-technisches-faci/798e5fcd-2c90-49dd-9167-ed558e9b8480'];
  const rows=(await Promise.all(urls.map(u=>detail(u,'Apleona Nordost GmbH','Apleona Hennigsdorf direkt','Hennigsdorf, Brandenburg','Hennigsdorf')))).filter(Boolean).filter(j=>/hennigsdorf/i.test(j.description));
  console.log(`[Apleona Hennigsdorf direkt] ${rows.length}`);return rows;
}

function links(html,base){const out=[];const re=/\bhref\s*=\s*["']([^"'#]+)["']/gi;let m;while((m=re.exec(html))){try{const u=new URL(m[1].replace(/&amp;/g,'&'),base);if(/^https?:$/.test(u.protocol))out.push(u.href.split('#')[0]);}catch{}}return[...new Set(out)];}
async function kwg(){
  const list='https://www.k-w-g.de/stellenanzeigen/';
  try{const html=await get(list);const urls=links(html,list).filter(u=>/k-w-g\.de\/stellenanzeigen\//i.test(u)&&u!==list).slice(0,20);const rows=(await Promise.all(urls.map(u=>detail(u,'Klärwerk Wansdorf GmbH','Klärwerk Wansdorf direkt','Klärwerksweg 1, 14621 Schönwalde-Glien','Schönwalde-Glien')))).filter(Boolean);console.log(`[Klärwerk Wansdorf direkt] ${rows.length}`);return rows;}catch(e){console.warn(`[Klärwerk Wansdorf direkt] ${e.message}`);return[];}
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}
  const groups=[await ennux(),await lebenshilfe(),await apleona(),await kwg()];let added=0,merged=0;
  for(const rows of groups)for(const j of rows){const r=merge(payload.jobs,j);r==='added'?added++:merged++;}
  payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  const stats=[['Ennux Falkensee direkt',groups[0].length],['Lebenshilfe Havelland direkt',groups[1].length],['Apleona Hennigsdorf direkt',groups[2].length],['Klärwerk Wansdorf direkt',groups[3].length]];
  for(const [name,count] of stats){const s=payload.meta.sources.find(x=>x.name===name);if(s){s.count=count;s.status='ok';}else payload.meta.sources.push({name,count,status:'ok'});}
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;payload.meta.expandedFalkenseeOfficeSearch=true;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');
  console.log(`Falkensee/Hennigsdorf Büro-Direktsuche: ${added} neue, ${merged} zusammengeführt.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
