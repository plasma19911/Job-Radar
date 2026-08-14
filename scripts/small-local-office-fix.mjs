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

async function get(url,tries=2){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const c=new AbortController();const timer=setTimeout(()=>c.abort(),22000);
      const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9'},redirect:'follow',signal:c.signal});clearTimeout(timer);
      if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();
    }catch(e){last=e;if(i<tries-1)await sleep(650*(i+1));}
  }
  throw last;
}
let cache={};
async function geocode(q){
  const key=`small-office-fix:${norm(q)}`;
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
function deadline(text){
  const s=String(text);const patterns=[
    /bewerbungsfrist\s*:?\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})/i,
    /möglich ist das bis(?: zum)?\s+(\d{1,2})\.(\d{1,2})\.(20\d{2})/i,
    /bewerb(?:en|ung)[^.!?]{0,80}?bis(?: zum)?\s+(\d{1,2})\.(\d{1,2})\.(20\d{2})/i,
    /bis zum\s+(\d{1,2})\.(\d{1,2})\.(20\d{2})/i,
    /\bbis\s+(\d{1,2})\.(\d{1,2})\.(20\d{2})/i
  ];
  for(const re of patterns){const m=s.match(re);if(!m)continue;const d=new Date(Date.UTC(+m[3],+m[2]-1,+m[1],23,59,59));if(!Number.isNaN(+d))return d;}
  return null;
}
function makeJob({title,company,location,address,geo,url,source,description,validThrough=null}){
  return {id:`small-office-fix-${hash(`${company}|${title}|${url}`)}`,title,company,location,address:geo?.display_name||address,lat:geo?.lat??null,lon:geo?.lon??null,remote:false,remoteFull:false,employmentType:[],publishedAt:null,validThrough:validThrough?validThrough.toISOString():null,url,source,sources:[{name:source,url}],description:clean(description).slice(0,7000),salary:null};
}

const CAREER_PAGES=[
  {source:'Steuerkanzlei Grotstabel direkt',company:'Steuerkanzlei Grotstabel',url:'https://steuerberatung-falkensee.com/karriere-steuerberatung-in-falkensee.html',location:'Falkensee',address:'Rudolf-Breitscheid-Str. 41, 14612 Falkensee',jobs:[
    ['Steuerassistent:in (m/w/d)',['steuerassistent']],
    ['Steuerfachangestellte:r (m/w/d)',['steuerfachangestellte']],
    ['Steuerfachwirt:in / Bilanzbuchhalter:in / Finanzwirt:in (m/w/d)',['steuerfachwirt','bilanzbuchhalter','finanzwirt']]
  ]},
  {source:'Pluta Steuerberatung Falkensee direkt',company:'Pluta Steuerberatung',url:'https://pluta-steuerberatung.de/karriere',location:'Falkensee',address:'Poststraße 20, 14612 Falkensee',jobs:[
    ['Steuerfachangestellte:r (m/w/d)',['steuerfachangestellter','steuerfachangestellte']]
  ]},
  {source:'Wichert Steuerberatung Falkensee direkt',company:'Wichert Steuerberatung',url:'https://jobs-wichert-steuerberater.de/',location:'Falkensee',address:'Schwarzburger Straße 63, 14612 Falkensee',jobs:[
    ['Steuerfachangestellte (m/w/d)',['steuerfachangestellte']],
    ['Steuerberater:in (m/w/d)',['steuerberater']],
    ['Lohnbuchhalter:in (m/w/d)',['lohnbuchhalter']]
  ]},
  {source:'ncn ImmobilienManagement Falkensee direkt',company:'ncn ImmobilienManagement GmbH',url:'https://www.ncn-immo.com/ueber-uns/karriere',location:'Falkensee',address:'Krummer Luchweg 29, 14612 Falkensee',jobs:[
    ['Immobilienkauffrau / Immobilienkaufmann (m/w/d)',['immobilienkauffrau','immobilienkaufmann']]
  ]}
];

async function careerPage(cfg){
  try{
    const html=await get(cfg.url),text=strip(html),n=norm(text),geo=await geocode(cfg.address),rows=[];
    for(const [title,terms] of cfg.jobs){if(!terms.some(t=>n.includes(norm(t))))continue;rows.push(makeJob({title,company:cfg.company,location:cfg.location,address:cfg.address,geo,url:cfg.url,source:cfg.source,description:text}));}
    console.log(`[FIX ${cfg.source}] ${rows.length}`);return rows;
  }catch(e){console.warn(`[FIX ${cfg.source}] ${e.message}`);return[];}
}

const DIRECT=[
  {source:'Johannesstift Büro direkt',company:'Johannesstift Diakonie Services',title:'Immobilienkauffrau *mann als Objektmanager*in kaufmännischer Bereich',key:'objektmanager',url:'https://www.johannesstift-diakonie.de/karriere-bildung/stellenangebote-bewerbung/stellenangebot/6185-immobilienkauffrau-mann-als-objektmanagerin-kaufmaennischer-bereich',location:'Berlin-Siemensstadt',address:'Siemensdamm 50, 13629 Berlin'},
  {source:'Johannesstift Büro direkt',company:'Johannesstift Diakonie Services',title:'Sachbearbeiter *in Informationssicherheit und Datenschutz',key:'informationssicherheit',url:'https://www.johannesstift-diakonie.de/karriere-bildung/stellenangebote-bewerbung/stellenangebot/6297-sachbearbeiter-in-informationssicherheit-und-datenschutz-berlin-spandau',location:'Berlin-Siemensstadt',address:'Siemensdamm 50, 13629 Berlin'},
  {source:'Johannesstift Büro direkt',company:'Evangelisches Waldkrankenhaus Spandau',title:'IT-Administrator *in',key:'it administrator',url:'https://www.johannesstift-diakonie.de/karriere-bildung/stellenangebote-bewerbung/stellenangebot/6186-it-administrator-in',location:'Berlin-Spandau',address:'Stadtrandstraße 555, 13589 Berlin'},
  {source:'Johannesstift Büro direkt',company:'Johannesstift Diakonie Services',title:'Facheinkäufer *in',key:'facheinkaufer',url:'https://www.johannesstift-diakonie.de/karriere-bildung/stellenangebote-bewerbung/stellenangebot/6176-facheinkaeufer-in-berlin-spandau',location:'Berlin-Siemensstadt',address:'Siemensdamm 50, 13629 Berlin'},
  {source:'Stadt Hennigsdorf Büro direkt',company:'Stadt Hennigsdorf',title:'Sachbearbeiter/in (m/w/d) für schulische Angelegenheiten',key:'schulische angelegenheiten',url:'https://www.hennigsdorf.de/Rathaus/Aktuelles/Stellenangebote-Sachbearbeiter-in-m-w-d-f%C3%BCr-schulische-Angelegenheiten.php?FID=3590.37124.1',location:'Hennigsdorf',address:'Rathausplatz 1, 16761 Hennigsdorf'}
];

async function direct(cfg){
  try{
    const html=await get(cfg.url),text=strip(html),n=norm(text);if(!n.includes(norm(cfg.key)))return null;
    const d=deadline(text);if(d&&d<new Date())return null;const geo=await geocode(cfg.address);
    return makeJob({title:cfg.title,company:cfg.company,location:cfg.location,address:cfg.address,geo,url:cfg.url,source:cfg.source,description:text,validThrough:d});
  }catch(e){console.warn(`[FIX ${cfg.source}] ${e.message}`);return null;}
}

async function johannesList(){
  const url='https://www.johannesstift-diakonie.de/karriere-bildung/stellenangebote-bewerbung/stellenangebot/online-bewerbung';
  const specs=[
    {title:'Sekretär *in Ergotherapieschule als Schwangerschaftsvertretung',key:'ergotherapieschule',company:'Evangelisches Waldkrankenhaus Spandau',location:'Berlin-Spandau',address:'Stadtrandstraße 555, 13589 Berlin'},
    {title:'Debitorenbuchhalter *in / Hauptbuchhalter *in',key:'debitorenbuchhalter',company:'Johannesstift Diakonie',location:'Berlin-Siemensstadt',address:'Siemensdamm 50, 13629 Berlin'}
  ];
  try{
    const html=await get(url),text=strip(html),n=norm(text),rows=[];
    for(const s of specs){if(!n.includes(norm(s.key)))continue;const geo=await geocode(s.address);rows.push(makeJob({...s,geo,url,source:'Johannesstift Büro-Liste direkt',description:text}));}
    console.log(`[FIX Johannesstift Büro-Liste direkt] ${rows.length}`);return rows;
  }catch(e){console.warn(`[FIX Johannesstift Büro-Liste direkt] ${e.message}`);return[];}
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));try{cache=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cache={};}
  let added=0,merged=0;const stats=[];
  for(const cfg of CAREER_PAGES){const rows=await careerPage(cfg);stats.push([`FIX ${cfg.source}`,rows.length]);for(const j of rows){merge(payload.jobs,j)==='added'?added++:merged++;}}
  const directRows=[];for(const cfg of DIRECT){const j=await direct(cfg);if(j)directRows.push(j);}stats.push(['FIX Johannesstift/Stadt Hennigsdorf Büro direkt',directRows.length]);for(const j of directRows){merge(payload.jobs,j)==='added'?added++:merged++;}
  const listRows=await johannesList();stats.push(['FIX Johannesstift Büro-Liste direkt',listRows.length]);for(const j of listRows){merge(payload.jobs,j)==='added'?added++:merged++;}
  payload.meta=payload.meta||{};payload.meta.sources=Array.isArray(payload.meta.sources)?payload.meta.sources:[];
  for(const [name,count] of stats){const hit=payload.meta.sources.find(x=>x.name===name);if(hit){hit.count=count;hit.status='ok';}else payload.meta.sources.push({name,count,status:'ok'});}
  payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;payload.meta.smallLocalOfficeFix=true;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');await fs.writeFile(CACHE,JSON.stringify(cache,null,2)+'\n');
  console.log(`Robuste lokale Büro-Nachprüfung: ${added} neue, ${merged} zusammengeführt.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
