import fs from 'node:fs/promises';

const OUT='public/data/jobs.json';
const ADDRESS='Marwitzer Str. 67, 13589 Berlin';
const FALLBACK=[52.5804,13.1729];
const RADIUS=15;
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';

function km(a,b){const R=6371,r=x=>x*Math.PI/180,dLat=r(b[0]-a[0]),dLon=r(b[1]-a[1]),q=Math.sin(dLat/2)**2+Math.cos(r(a[0]))*Math.cos(r(b[0]))*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));}
function coords(j){return Number.isFinite(j.lat)&&Number.isFinite(j.lon)?[j.lat,j.lon]:null;}
async function center(){try{const u=new URL('https://nominatim.openstreetmap.org/search');u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',ADDRESS);const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'de-DE'}});if(r.ok){const d=await r.json();if(d[0])return[+d[0].lat,+d[0].lon];}}catch{}return FALLBACK;}
async function main(){const payload=JSON.parse(await fs.readFile(OUT,'utf8'));const c=await center();const before=payload.jobs.length;payload.jobs=payload.jobs.filter(j=>{if(j.remoteFull===true)return true;const p=coords(j);return p&&km(c,p)<=RADIUS;});payload.jobs.sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0));payload.meta.generatedAt=new Date().toISOString();payload.meta.total=payload.jobs.length;payload.meta.scope={address:ADDRESS,radiusKm:RADIUS,pureHomeofficeWorldwide:true,center:{lat:c[0],lon:c[1]}};payload.meta.localWithin15km=payload.jobs.filter(j=>j.remoteFull!==true).length;payload.meta.remoteFull=payload.jobs.filter(j=>j.remoteFull===true).length;payload.meta.trainingOffers=false;await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');console.log(`Scope: ${before} -> ${payload.jobs.length}; local ${payload.meta.localWithin15km}; pure remote ${payload.meta.remoteFull}`);}
main().catch(e=>{console.error(e);process.exit(1);});
