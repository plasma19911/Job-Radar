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

async function get(url){
  const c=new AbortController();const timer=setTimeout(()=>c.abort(),22000);
  try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9'},redirect:'follow',signal:c.signal});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();}
  finally{clearTimeout(timer);}
}

let cache={};
async function geocode(q){
  const key=`micro-local:${norm(q)}`;
  if(Object.hasOwn(cache,key))return cache[key];
  try{await sleep(1100);const u=new URL('https://nominatim.openstreetmap.org/search');u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',q);const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'de-DE'}});const d=r.ok?await r.json():[];cache[key]=d[0]?{lat:+d[0].lat,lon:+d[0].lon,display_name:d[0].display_name}:null;}catch{cache[key]=null;}return cache[key];
}

function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland|partgmbb)\b/g,' ').replace(/\s+/g,' ').trim();}
function same(a,b){const ac=companyNorm(a.company),bc=companyNorm(b.company);if(!ac||!bc||ac!==bc)return false;const at=norm(a.title),bt=norm(b.title);return at===bt||(at.length>12&&bt.length>12&&(at.includes(bt)||bt.includes(at)));}
function merge(base,j){const hit=base.find(x=>same(x,j));if(!hit){base.push(j);return'added';}hit.sources=Array.isArray(hit.sources)?hit.sources:[];if(!hit.sources.some(s=>s.url===j.url))hit.sources.push({name:j.source,url:j.url});if(!hit.lat&&j.lat){hit.lat=j.lat;hit.lon=j.lon;hit.address=j.address;}if((j.description||'').length>(hit.description||'').length)hit.description=j.description;return'merged';}
function excluded(title=''){const t=norm(title);return /(ausbildungsplatz|auszubild|azubi|lehrstelle|duales studium|werkstudent|working student|studentische hilfskraft|praktikum|praktikant|praktikantin|internship)/i.test(t);}
function makeJob(cfg,text,geo){return {id:`micro-local-${hash(`${cfg.company}|${cfg.title}|${cfg.url}`)}`,title:cfg.title,company:cfg.company,location:cfg.location,address:geo?.display_name||cfg.address,lat:geo?.lat??null,lon:geo?.lon??null,remote:false,remoteFull:false,employmentType:cfg.employmentType||[],publishedAt:null,validThrough:null,url:cfg.url,source:cfg.source,sources:[{name:cfg.source,url:cfg.url}],description:text.slice(0,7000),salary:null};}

const JOBS=[
  {source:'Runge & Partner Spandau direkt',company:'Kanzlei Runge & Partner',title:'Steuerfachangestellte:r (m/w/d)',key:'steuerfachangestellte',location:'Berlin-Spandau',address:'Heerstraße 616, 13591 Berlin',url:'https://runge-und-partner.de/steuerberater-karriere/',employmentType:['Vollzeit','Teilzeit']},
  {source:'hok Steuerberatung Spandau direkt',company:'hok Steuerberatung',title:'Steuerfachwirt:in (m/w/d)',key:'steuerfachwirt',location:'Berlin-Spandau',address:'Kolk 1, 13597 Berlin',url:'https://www.hok-steuerberater.de/karriere',employmentType:['Vollzeit','Teilzeit']},
  {source:'Kneffel Steuerberatung Spandau direkt',company:'Kneffel Steuerberatungsgesellschaft mbH',title:'Steuerfachwirt:in (m/w/d)',key:'steuerfachwirt',location:'Berlin-Spandau',address:'Brüderstraße 45, 13595 Berlin',url:'https://www.kneffel-steuerberatung.de/karriere/',employmentType:['Vollzeit','Teilzeit']},
  {source:'Kneffel Steuerberatung Spandau direkt',company:'Kneffel Steuerberatungsgesellschaft mbH',title:'Steuerfachangestellte:r (m/w/d)',key:'steuerfachangestellte',location:'Berlin-Spandau',address:'Brüderstraße 45, 13595 Berlin',url:'https://www.kneffel-steuerberatung.de/karriere/',employmentType:['Vollzeit','Teilzeit']},
  {source:'Steuerkanzlei Dominique Helle Eiswerder',company:'Steuerkanzlei Dominique Helle',title:'Steuerfachangestellte:r / Steuerfachwirt:in (m/w/d)',key:'steuerfachangestellte',location:'Berlin-Spandau',address:'Eiswerderstraße 18 E, 13585 Berlin',url:'https://stbverband.de/jobboerse/angebote-fuer-mitarbeitende/steuerfachangestellte-r-steuerfachwirt-in-in-voll-oder-teilzeit-2070455/',employmentType:['Vollzeit','Teilzeit']},
  {source:'Steuerkanzlei Benjamin Behrendt Eiswerder',company:'Steuerkanzlei Benjamin Behrendt',title:'Steuerfachangestellte:r / Steuerfachwirt:in (m/w/d)',key:'steuerfachangestellte',location:'Berlin-Spandau',address:'Eiswerderstraße 18 E, 13585 Berlin',url:'https://stbverband.de/jobboerse/angebote-fuer-mitarbeitende/steuerfachangestellte-r-steuerfachwirt-in-in-voll-oder-teilzeit-1548337/',employmentType:['Vollzeit','Teilzeit']},
  {source:'SPREE ECKE HAVEL Praxis direkt',company:'SPREE ECKE HAVEL - Jacob & Jacob Dental Care Berlin',title:'ZMV - Rezeption & Abrechnung (m/w/d)',key:'zmv',location:'Berlin-Spandau',address:'Eiswerderstraße 16 D, 13585 Berlin',url:'https://spree-ecke-havel.de/jobs',employmentType:['Vollzeit','Teilzeit']},
  {source:'RehaSport Deutschland Eiswerder',company:'RehaSport Deutschland e.V.',title:'Finanzbuchhaltung & Büromanagement (m/w/d)',key:'finanzbuchhaltung',location:'Berlin-Spandau',address:'Eiswerderstraße 20, 13585 Berlin',url:'https://de.linkedin.com/jobs/view/finanzbuchhaltung-b%C3%BCromanagement-m-w-d-at-rehasport-deutschland-e-v-4432324773',employmentType:['Vollzeit']},
  {source:'Leichter Hausverwaltung Falkensee direkt',company:'Leichter Hausverwaltung e.K.',title:'Hausverwaltung (m/w/d)',key:'leichter hausverwaltung',location:'Falkensee',address:'Berliner Straße 67, 14612 Falkensee',url:'https://de.indeed.com/Jobs?lang=de&q=gfad+haussoft',employmentType:['Teilzeit']},
  {source:'Johanniter Service Wohnen Falkensee direkt',company:'Johanniter-Unfall-Hilfe e.V.',title:'Koordinator (m/w/d) Service Wohnen',key:'service wohnen',location:'Falkensee',address:'Dallgower Straße 16, 14612 Falkensee',url:'https://www.johanniter.de/juh/lv-bb/rv-brandenburg-nordwest/mitarbeiten-lernen/job-details/koordinator-m-w-d-service-wohnen-60105/',employmentType:['Vollzeit','Teilzeit']},
  {source:'Dinnebier BritCars Spandau direkt',company:'Autohaus Dinnebier GmbH',title:'Serviceassistenz (m/w/d) | BritCars | Berlin/Spandau',key:'serviceassistenz',location:'Berlin-Spandau',address:'Brunsbütteler Damm 192-194, 13581 Berlin',url:'https://dinnebiergruppe.softgarden.io/job/59392548',employmentType:['Vollzeit']},
  {source:'Volkswagen Automobile Tegel direkt',company:'Volkswagen Automobile Berlin GmbH',title:'Volkswagen Verkaufsassistenz im Backoffice (m/w/d)',key:'verkaufsassistenz',location:'Berlin-Tegel',address:'Berliner Straße 68, 13507 Berlin',url:'https://karriere.vgrd-gruppe.de/offer/volkswagen-verkaufsassistenz-im-bac/8caaaadf-54c5-4b60-8583-4df1d8e5084d',employmentType:['Vollzeit']},
  {source:'Volkswagen Automobile Tegel direkt',company:'Volkswagen Automobile Berlin GmbH',title:'Volkswagen Mitarbeiter im Kundendienst (m/w/d)',key:'kundendienst',location:'Berlin-Tegel',address:'Berliner Straße 68, 13507 Berlin',url:'https://karriere.vgrd-gruppe.de/offer/volkswagen-mitarbeiter-im-kundendie/b09f78be-d211-4525-9d12-cf77a0af3231',employmentType:['Vollzeit']},
  {source:'Autohaus Berolina Spandau direkt',company:'Autohaus Berolina GmbH',title:'Assistent Fahrzeugeinkauf / Datenerfasser (m/w/x)',key:'assistent fahrzeugeinkauf',location:'Berlin-Spandau',address:'Brunsbütteler Damm 40-50, 13581 Berlin',url:'https://de.indeed.com/viewjob?jk=28c3261c14f60cdd',employmentType:['Teilzeit']},
  {source:'RENAFAN Immobilienverwaltung Tegel direkt',company:'RENAFAN GmbH',title:'Sachbearbeiter (m/w/d) Betriebskostenabrechnung',key:'betriebskostenabrechnung',location:'Berlin-Tegel',address:'Berliner Straße 36/37, 13507 Berlin',url:'https://portal.oproma.de/jobs/sachbearbeiter-m-w-d-betriebskostenabrechnung-ID-5044908',employmentType:['Vollzeit','Teilzeit']},
  {source:'Zahnarztpraxis Bekci Tegel direkt',company:'Zahnarztpraxis Tonyukuk Bekci',title:'Zahnmedizinische Fachangestellte – Abrechnung & Praxisverwaltung (m/w/d)',key:'abrechnung und verwaltung',location:'Berlin-Tegel',address:'Buddestraße 15, 13507 Berlin',url:'https://www.make-it-in-germany.com/en/working-in-germany/job-listings/job/job-10000-1206385443-S',employmentType:['Vollzeit','Teilzeit']}
];

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}
  let added=0,merged=0;const counts=new Map();
  for(const cfg of JOBS){
    try{
      const html=await get(cfg.url),text=strip(html),n=norm(text);
      if(!n.includes(norm(cfg.key))){console.warn(`[${cfg.source}] Titel/Schlüssel nicht mehr gefunden: ${cfg.title}`);continue;}
      if(excluded(cfg.title))continue;
      const geo=await geocode(cfg.address);const r=merge(payload.jobs,makeJob(cfg,text,geo));r==='added'?added++:merged++;counts.set(cfg.source,(counts.get(cfg.source)||0)+1);
    }catch(e){console.warn(`[${cfg.source}] ${cfg.title}: ${e.message}`);}
  }
  payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  for(const source of [...new Set(JOBS.map(x=>x.source))]){const count=counts.get(source)||0;const hit=payload.meta.sources.find(x=>x.name===source);if(hit){hit.count=count;hit.status='ok';}else payload.meta.sources.push({name:source,count,status:'ok'});}
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;payload.meta.microLocalOffice=true;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');
  console.log(`Kleinstarbeitgeber Büro-Suche: ${added} neue, ${merged} zusammengeführt.`);
}

main().catch(e=>{console.error(e);process.exit(1);});
