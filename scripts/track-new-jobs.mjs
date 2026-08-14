import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync=promisify(execFile);
const OUT='public/data/jobs.json';
const DAY=24*60*60*1000;
const BOOTSTRAP_AGE_DAYS=8;

function norm(v=''){
  return String(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function cleanUrl(v=''){
  try{const u=new URL(v);u.hash='';['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(k=>u.searchParams.delete(k));return u.toString().replace(/\/$/,'');}catch{return String(v||'').trim();}
}
function keys(j){
  const out=[];
  if(j?.id)out.push(`id:${j.id}`);
  const url=cleanUrl(j?.url||j?.sources?.[0]?.url||'');
  if(url)out.push(`url:${url}`);
  const core=[norm(j?.company),norm(j?.title),norm(j?.location)].join('|');
  if(core.replace(/\|/g,''))out.push(`core:${core}`);
  return out;
}
async function previousPayload(){
  try{
    const {stdout}=await execFileAsync('git',['show',`HEAD:${OUT}`],{maxBuffer:30*1024*1024});
    return JSON.parse(stdout);
  }catch{return {jobs:[]};}
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));
  const previous=await previousPayload();
  const now=new Date();
  const nowIso=now.toISOString();
  const bootstrapIso=new Date(now.getTime()-BOOTSTRAP_AGE_DAYS*DAY).toISOString();
  const oldByKey=new Map();
  for(const j of Array.isArray(previous.jobs)?previous.jobs:[]){for(const k of keys(j))if(!oldByKey.has(k))oldByKey.set(k,j);}

  let added=0,preserved=0,bootstrapped=0;
  for(const j of Array.isArray(payload.jobs)?payload.jobs:[]){
    let old=null;
    for(const k of keys(j)){if(oldByKey.has(k)){old=oldByKey.get(k);break;}}
    if(old?.firstSeenAt){j.firstSeenAt=old.firstSeenAt;preserved++;}
    else if(old){j.firstSeenAt=bootstrapIso;bootstrapped++;}
    else{j.firstSeenAt=nowIso;added++;}
  }

  payload.meta=payload.meta||{};
  payload.meta.newJobsTracking={windowDays:7,addedThisScan:added,trackedAt:nowIso};
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');
  console.log(`Neue-Job-Tracking: ${added} neu, ${preserved} Zeitstempel übernommen, ${bootstrapped} Bestandsjobs initialisiert.`);
}

main().catch(e=>{console.error(e);process.exit(1);});
