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
  const published=j?.publishedAt?String(j.publishedAt).slice(0,10):'';
  const core=[norm(j?.company),norm(j?.title),norm(j?.location),published].join('|');
  if(core.replace(/\|/g,''))out.push(`core:${core}`);
  return out;
}
function indexJobs(payload){
  const map=new Map();
  for(const j of Array.isArray(payload?.jobs)?payload.jobs:[]){for(const k of keys(j))if(!map.has(k))map.set(k,j);}
  return map;
}
function match(map,j){for(const k of keys(j))if(map.has(k))return map.get(k);return null;}
async function git(args){const {stdout}=await execFileAsync('git',args,{maxBuffer:30*1024*1024});return stdout.trim();}
async function payloadAt(ref){try{return JSON.parse(await git(['show',`${ref}:${OUT}`]));}catch{return {jobs:[]};}}
async function dataHistory(){
  try{
    const hashes=(await git(['log','-2','--format=%H','--',OUT])).split(/\s+/).filter(Boolean);
    const latest=hashes[0]||null,older=hashes[1]||null;
    const latestTime=latest?await git(['show','-s','--format=%cI',latest]):'';
    return {latest,older,latestTime};
  }catch{return {latest:null,older:null,latestTime:''};}
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));
  const previous=await payloadAt('HEAD');
  const history=await dataHistory();
  const older=history.older?await payloadAt(history.older):{jobs:[]};
  const previousIndex=indexJobs(previous);
  const olderIndex=indexJobs(older);
  const now=new Date();
  const nowIso=now.toISOString();
  const bootstrapIso=new Date(now.getTime()-BOOTSTRAP_AGE_DAYS*DAY).toISOString();
  const lastScanIso=history.latestTime&&Number.isFinite(new Date(history.latestTime).getTime())?new Date(history.latestTime).toISOString():nowIso;

  let added=0,preserved=0,bootstrapped=0,seededPreviousScan=0;
  for(const j of Array.isArray(payload.jobs)?payload.jobs:[]){
    const old=match(previousIndex,j);
    if(old?.firstSeenAt){
      j.firstSeenAt=old.firstSeenAt;
      preserved++;
    }else if(old){
      if(match(olderIndex,j)){
        j.firstSeenAt=bootstrapIso;
        bootstrapped++;
      }else{
        j.firstSeenAt=lastScanIso;
        seededPreviousScan++;
      }
    }else{
      j.firstSeenAt=nowIso;
      added++;
    }
  }

  payload.meta=payload.meta||{};
  payload.meta.newJobsTracking={windowDays:7,addedThisScan:added,seededFromPreviousScan:seededPreviousScan,trackedAt:nowIso};
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');
  console.log(`Neue-Job-Tracking: ${added} neu in diesem Scan, ${seededPreviousScan} aus dem letzten abgeschlossenen Scan übernommen, ${preserved} Zeitstempel beibehalten, ${bootstrapped} ältere Bestandsjobs initialisiert.`);
}

main().catch(e=>{console.error(e);process.exit(1);});
