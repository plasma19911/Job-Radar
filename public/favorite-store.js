const STORAGE_KEY='jobRadarFavoritesV2';
const LEGACY_KEY='jobRadarFavorites';
const DB_NAME='job-radar-state-v1';
const DB_STORE='state';
const DB_ITEM='favorites-v2';

const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß]+/g,' ').replace(/\s+/g,' ').trim();
const stableUrl=v=>{try{const u=new URL(v,location.href);u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(ref|source|src|campaign|tracking|trk)$/i.test(k))u.searchParams.delete(k);return`${u.origin}${u.pathname}${u.search}`;}catch{return'';}};

export function favoriteKey(job={}){
  const company=norm(job.company||'');
  const title=norm(job.title||'');
  const place=job.remoteFull===true?'remote':norm(job.location||job.address||'');
  if(company&&title)return`ct:${company}|${title}|${place}`;
  const url=stableUrl(job.url||job.sources?.[0]?.url||'');
  if(url)return`url:${url}`;
  return job.id?`id:${job.id}`:'';
}

function parseLocal(){
  try{
    const raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(Array.isArray(raw))return raw;
    if(Array.isArray(raw?.keys))return raw.keys;
  }catch{}
  return [];
}

function legacyIds(){
  try{const raw=JSON.parse(localStorage.getItem(LEGACY_KEY)||'[]');return Array.isArray(raw)?raw:[];}catch{return[];}
}

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB'in window))return resolve(null);
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(DB_STORE))req.result.createObjectStore(DB_STORE);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function readDb(){
  try{const db=await openDb();if(!db)return[];return await new Promise(resolve=>{const tx=db.transaction(DB_STORE,'readonly'),r=tx.objectStore(DB_STORE).get(DB_ITEM);r.onsuccess=()=>resolve(Array.isArray(r.result?.keys)?r.result.keys:[]);r.onerror=()=>resolve([]);});}catch{return[];}
}
async function writeDb(keys){
  try{const db=await openDb();if(!db)return;await new Promise(resolve=>{const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put({keys:[...keys],savedAt:new Date().toISOString()},DB_ITEM);tx.oncomplete=resolve;tx.onerror=resolve;});}catch{}
}

export async function loadFavoriteKeys(jobs=[]){
  const keys=new Set([...parseLocal(),...await readDb()].filter(Boolean));
  let migrated=false;
  const old=legacyIds();
  if(old.length){
    const ids=new Set(old.map(String));
    for(const j of jobs){if(ids.has(String(j.id))){const k=favoriteKey(j);if(k){keys.add(k);migrated=true;}}}
  }
  if(migrated||keys.size)await saveFavoriteKeys(keys,false);
  return keys;
}

export function isFavorite(job,keys){const k=favoriteKey(job);return Boolean(k&&keys?.has(k));}

export async function saveFavoriteKeys(keys,notify=true){
  const list=[...keys].filter(Boolean).slice(-3000);
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:2,keys:list,savedAt:new Date().toISOString()}));}catch{}
  await writeDb(new Set(list));
  if(notify)window.dispatchEvent(new CustomEvent('jobradar:favorites-changed',{detail:{keys:list}}));
}

export async function toggleFavorite(job,keys){
  const k=favoriteKey(job);if(!k)return false;
  if(keys.has(k))keys.delete(k);else keys.add(k);
  await saveFavoriteKeys(keys,true);
  return keys.has(k);
}

export function replaceFavoriteKeys(keys,list){keys.clear();for(const k of list||[])if(k)keys.add(k);}
