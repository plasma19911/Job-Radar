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

function excluded(title='',text=''){
  const t=norm(`${title} ${text}`);
  return /(ausbildung|ausbildungsplatz|auszubild|azubi|lehrstelle|duales studium|dual studium|werkstudent|werkstudentin|werkstudierende|working student|studentische hilfskraft|student assistant|studentenjob|student job|praktikum|praktikant|praktikantin|praktikumsplatz|internship|\bintern\b|schülerpraktikum|schuelerpraktikum)/i.test(t);
}
async function get(url,tries=2){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const c=new AbortController();const timer=setTimeout(()=>c.abort(),22000);
      const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9'},redirect:'follow',signal:c.signal});clearTimeout(timer);
      if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();
    }catch(e){last=e;if(i<tries-1)await sleep(600*(i+1));}
  }
  throw last;
}
let cache={};
async function geocode(q){
  const key=`small-office:${norm(q)}`;
  if(Object.hasOwn(cache,key))return cache[key];
  try{
    await sleep(1100);const u=new URL('https://nominatim.openstreetmap.org/search');u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',q);
    const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'de-DE'}});if(!r.ok)throw new Error(String(r.status));const d=await r.json();
    cache[key]=d[0]?{lat:+d[0].lat,lon:+d[0].lon,display_name:d[0].display_name}:null;
  }catch{cache[key]=null;}
  return cache[key];
}
function companyNorm(v=''){return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland|partgmbb)\b/g,' ').replace(/\s+/g,' ').trim();}
function same(a,b){
  const ac=companyNorm(a.company),bc=companyNorm(b.company);if(!ac||!bc||ac!==bc)return false;
  const at=norm(a.title),bt=norm(b.title);return at===bt||(at.length>12&&bt.length>12&&(at.includes(bt)||bt.includes(at)));
}
function merge(base,j){
  const hit=base.find(x=>same(x,j));if(!hit){base.push(j);return'added';}
  hit.sources=Array.isArray(hit.sources)?hit.sources:[];if(!hit.sources.some(s=>s.url===j.url))hit.sources.push({name:j.source,url:j.url});
  if(!hit.lat&&j.lat){hit.lat=j.lat;hit.lon=j.lon;hit.address=j.address;}
  if((j.description||'').length>(hit.description||'').length)hit.description=j.description;
  return'merged';
}
function parseDeadline(text){
  const m=String(text).match(/(?:bis\s+(?:zum\s+)?)?(\d{1,2})\.(\d{1,2})\.(20\d{2})/i);if(!m)return null;
  const d=new Date(Date.UTC(+m[3],+m[2]-1,+m[1],23,59,59));return Number.isNaN(+d)?null:d;
}
function stillOpen(text){const d=parseDeadline(text);return !d||d>=new Date();}
function makeJob({title,company,location,address,geo,url,source,description,validThrough=null,employmentType=[]}){
  return {id:`small-office-${hash(`${company}|${title}|${url}`)}`,title,company,location,address:geo?.display_name||address,lat:geo?.lat??null,lon:geo?.lon??null,remote:false,remoteFull:false,employmentType,publishedAt:null,validThrough:validThrough?validThrough.toISOString():null,url,source,sources:[{name:source,url}],description:clean(description).slice(0,7000),salary:null};
}

const PAGE_SOURCES=[
  {
    source:'Steuerkanzlei Grotstabel direkt',company:'Steuerkanzlei Grotstabel',url:'https://steuerberatung-falkensee.com/karriere-steuerberatung-in-falkensee.html',location:'Falkensee',address:'Rudolf-Breitscheid-Str. 41, 14612 Falkensee',
    jobs:[
      {title:'Steuerassistent:in (m/w/d)',terms:['steuerassistent']},
      {title:'Steuerfachangestellte:r (m/w/d)',terms:['steuerfachangestellte']},
      {title:'Steuerfachwirt:in / Bilanzbuchhalter:in / Finanzwirt:in (m/w/d)',terms:['steuerfachwirt','bilanzbuchhalter','finanzwirt']}
    ]
  },
  {
    source:'Pluta Steuerberatung Falkensee direkt',company:'Pluta Steuerberatung',url:'https://pluta-steuerberatung.de/karriere',location:'Falkensee',address:'Poststraße 20, 14612 Falkensee',
    jobs:[{title:'Steuerfachangestellte:r (m/w/d)',terms:['steuerfachangestellter']}]
  },
  {
    source:'Wichert Steuerberatung Falkensee direkt',company:'Wichert Steuerberatung',url:'https://jobs-wichert-steuerberater.de/',location:'Falkensee',address:'Schwarzburger Straße 63, 14612 Falkensee',
    jobs:[
      {title:'Steuerfachangestellte (m/w/d)',terms:['steuerfachangestellte']},
      {title:'Steuerberater:in (m/w/d)',terms:['steuerberater']},
      {title:'Lohnbuchhalter:in (m/w/d)',terms:['lohnbuchhalter']}
    ]
  },
  {
    source:'ncn ImmobilienManagement Falkensee direkt',company:'ncn ImmobilienManagement GmbH',url:'https://www.ncn-immo.com/ueber-uns/karriere',location:'Falkensee',address:'Krummer Luchweg 29, 14612 Falkensee',
    jobs:[{title:'Immobilienkauffrau / Immobilienkaufmann (m/w/d)',terms:['immobilienkauffrau','immobilienkaufmann']}]
  }
];

async function pageJobs(cfg){
  try{
    const html=await get(cfg.url),text=strip(html),n=norm(text);const geo=await geocode(cfg.address);const out=[];
    for(const spec of cfg.jobs){
      if(!spec.terms.some(t=>n.includes(norm(t))))continue;
      if(excluded(spec.title,text))continue;
      out.push(makeJob({title:spec.title,company:cfg.company,location:cfg.location,address:cfg.address,geo,url:cfg.url,source:cfg.source,description:text}));
    }
    console.log(`[${cfg.source}] ${out.length}`);return out;
  }catch(e){console.warn(`[${cfg.source}] ${e.message}`);return[];}
}

const DETAIL_SOURCES=[
  {source:'Johannesstift Büro direkt',company:'Johannesstift Diakonie Services',url:'https://www.johannesstift-diakonie.de/karriere-bildung/stellenangebote-bewerbung/stellenangebot/6185-immobilienkauffrau-mann-als-objektmanagerin-kaufmaennischer-bereich',location:'Berlin-Spandau',address:'Siemensdamm 50, 13629 Berlin'},
  {source:'Johannesstift Büro direkt',company:'Johannesstift Diakonie Services',url:'https://www.johannesstift-diakonie.de/karriere-bildung/stellenangebote-bewerbung/stellenangebot/6297-sachbearbeiter-in-informationssicherheit-und-datenschutz-berlin-spandau',location:'Berlin-Siemensstadt',address:'Siemensdamm 50, 13629 Berlin'},
  {source:'Johannesstift Büro direkt',company:'Evangelisches Waldkrankenhaus Spandau',url:'https://www.johannesstift-diakonie.de/karriere-bildung/stellenangebote-bewerbung/stellenangebot/6186-it-administrator-in',location:'Berlin-Spandau',address:'Stadtrandstraße 555, 13589 Berlin'},
  {source:'Johannesstift Büro direkt',company:'Johannesstift Diakonie Services',url:'https://www.johannesstift-diakonie.de/karriere-bildung/stellenangebote-bewerbung/stellenangebot/6176-facheinkaeufer-in-berlin-spandau',location:'Berlin-Siemensstadt',address:'Siemensdamm 50, 13629 Berlin'},
  {source:'Stadt Hennigsdorf Büro direkt',company:'Stadt Hennigsdorf',url:'https://www.hennigsdorf.de/Rathaus/Aktuelles/Stellenangebote-Sachbearbeiter-in-m-w-d-f%C3%BCr-schulische-Angelegenheiten.php?FID=3590.37124.1',location:'Hennigsdorf',address:'Rathausplatz 1, 16761 Hennigsdorf'}
];

async function detailJob(cfg){
  try{
    const html=await get(cfg.url),text=strip(html);if(!stillOpen(text))return null;
    let title=strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'');
    if(!title||/^wir suchen sie/i.test(title))title=strip(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]||title);
    title=title.replace(/^Stellenangebot\s*[-–:]?\s*/i,'').replace(/^Wir suchen Sie[^:]*:?\s*/i,'').trim();
    if(!title||title.length<5||excluded(title,text))return null;
    const geo=await geocode(cfg.address);const deadline=parseDeadline(text);
    return makeJob({title,company:cfg.company,location:cfg.location,address:cfg.address,geo,url:cfg.url,source:cfg.source,description:text,validThrough:deadline});
  }catch(e){console.warn(`[${cfg.source}] ${cfg.url}: ${e.message}`);return null;}
}

async function johannesListJobs(){
  const url='https://www.johannesstift-diakonie.de/karriere-bildung/stellenangebote-bewerbung/stellenangebot/online-bewerbung';
  try{
    const html=await get(url),text=strip(html),n=norm(text);const specs=[
      {title:'Sekretär *in Ergotherapieschule als Schwangerschaftsvertretung',terms:['sekretar in ergotherapieschule'],company:'Evangelisches Waldkrankenhaus Spandau',address:'Stadtrandstraße 555, 13589 Berlin',location:'Berlin-Spandau'},
      {title:'Debitorenbuchhalter *in / Hauptbuchhalter *in',terms:['debitorenbuchhalter','hauptbuchhalter'],company:'Johannesstift Diakonie',address:'Siemensdamm 50, 13629 Berlin',location:'Berlin-Siemensstadt'}
    ];const out=[];
    for(const s of specs){if(!s.terms.some(t=>n.includes(norm(t)))||excluded(s.title,text))continue;const geo=await geocode(s.address);out.push(makeJob({title:s.title,company:s.company,location:s.location,address:s.address,geo,url,source:'Johannesstift Büro-Liste direkt',description:text}));}
    console.log(`[Johannesstift Büro-Liste direkt] ${out.length}`);return out;
  }catch(e){console.warn(`[Johannesstift Büro-Liste direkt] ${e.message}`);return[];}
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}
  const groups=[];
  for(const cfg of PAGE_SOURCES)groups.push({name:cfg.source,rows:await pageJobs(cfg)});
  const detailRows=[];for(const cfg of DETAIL_SOURCES){const j=await detailJob(cfg);if(j)detailRows.push(j);}groups.push({name:'Johannesstift/Stadt Hennigsdorf Büro direkt',rows:detailRows});
  groups.push({name:'Johannesstift Büro-Liste direkt',rows:await johannesListJobs()});
  let added=0,merged=0;
  for(const g of groups)for(const j of g.rows){const r=merge(payload.jobs,j);r==='added'?added++:merged++;}
  payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  for(const g of groups){const hit=payload.meta.sources.find(x=>x.name===g.name);if(hit){hit.count=g.rows.length;hit.status='ok';}else payload.meta.sources.push({name:g.name,count:g.rows.length,status:'ok'});}
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;payload.meta.smallLocalOfficeEmployers=true;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');
  console.log(`Kleine lokale Büro-Arbeitgeber: ${added} neue, ${merged} zusammengeführt.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
