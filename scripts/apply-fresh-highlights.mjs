import fs from 'node:fs/promises';

const APP='public/app.js';
const INDEX='public/index.html';
const CSS='public/fresh-highlights.css';
const SW='public/sw.js';

function mustReplace(source,search,replacement,label){
  if(!source.includes(search)) throw new Error(`Patchstelle nicht gefunden: ${label}`);
  return source.replace(search,replacement);
}

async function patchApp(){
  let s=await fs.readFile(APP,'utf8');

  if(!s.includes("const FRESH_WINDOW_MS=3*24*60*60*1000;")){
    s=mustReplace(s,"const RADIUS_KM=10;\n","const RADIUS_KM=10;\nconst FRESH_WINDOW_MS=3*24*60*60*1000;\n",'3-Tage-Konstante');
  }

  if(!s.includes("const fresh3=j=>")){
    s=mustReplace(
      s,
      "const ageDays=v=>v?Math.floor((Date.now()-new Date(v).getTime())/86400000):999;",
      "const ageDays=v=>v?Math.floor((Date.now()-new Date(v).getTime())/86400000):999;\nconst fresh3=j=>{const t=new Date(j.firstSeenAt||0).getTime(),d=Date.now()-t;return Number.isFinite(t)&&t>0&&d>=0&&d<FRESH_WINDOW_MS;};",
      'fresh3-Helfer'
    );
  }

  if(!s.includes("const freshPinIcon=")){
    s=mustReplace(
      s,
      "const pinIcon=L.divIcon({className:'job-marker',html:'<div class=\"job-pin\"><span>●</span></div>',iconSize:[31,31],iconAnchor:[15,30],popupAnchor:[0,-28]});",
      "const pinIcon=L.divIcon({className:'job-marker',html:'<div class=\"job-pin\"><span>●</span></div>',iconSize:[31,31],iconAnchor:[15,30],popupAnchor:[0,-28]});\nconst freshPinIcon=L.divIcon({className:'job-marker fresh-job-marker',html:'<div class=\"job-pin fresh-job-pin\"><span>N</span></div>',iconSize:[35,35],iconAnchor:[17,34],popupAnchor:[0,-32]});",
      'NEU-Kartenmarker'
    );
  }

  if(!s.includes("if(state.filter==='all'){const af=fresh3(a),bf=fresh3(b)")){
    const oldSort="function sortJobs(){const m=els.sort.value;state.filtered.sort((a,b)=>{if(m==='newest')return new Date(b.publishedAt||0)-new Date(a.publishedAt||0);if(m==='title')return(a.title||'').localeCompare(b.title||'','de');const ad=pureRemote(a)?Infinity:localDistance(a),bd=pureRemote(b)?Infinity:localDistance(b);if(ad!==bd)return ad-bd;return new Date(b.publishedAt||0)-new Date(a.publishedAt||0);});}";
    const newSort="function sortJobs(){const m=els.sort.value;state.filtered.sort((a,b)=>{if(state.filter==='all'){const af=fresh3(a),bf=fresh3(b);if(af!==bf)return af?-1:1;if(af&&bf){const d=new Date(b.firstSeenAt||0)-new Date(a.firstSeenAt||0);if(d)return d;}}if(m==='newest')return new Date(b.publishedAt||0)-new Date(a.publishedAt||0);if(m==='title')return(a.title||'').localeCompare(b.title||'','de');const ad=pureRemote(a)?Infinity:localDistance(a),bd=pureRemote(b)?Infinity:localDistance(b);if(ad!==bd)return ad-bd;return new Date(b.publishedAt||0)-new Date(a.publishedAt||0);});}";
    s=mustReplace(s,oldSort,newSort,'NEU-zuerst-Sortierung');
  }

  if(!s.includes("(fresh3(j)?' fresh-job-card':'')")){
    s=mustReplace(
      s,
      "card.className='job-card'+(state.selectedJobId===j.id?' selected':'');",
      "card.className='job-card'+(fresh3(j)?' fresh-job-card':'')+(state.selectedJobId===j.id?' selected':'');",
      'NEU-Jobkarte'
    );
  }

  if(!s.includes('fresh-new-badge')){
    s=mustReplace(
      s,
      "${ageDays(j.publishedAt)<=2?'<span class=\"new-badge\">NEU</span>':''}",
      "${fresh3(j)?'<span class=\"new-badge fresh-new-badge\" title=\"Neu im Radar – 3 Tage hervorgehoben\">NEU</span>':''}",
      'NEU-Badge'
    );
  }

  if(!s.includes("icon:fresh3(j)?freshPinIcon:pinIcon")){
    s=mustReplace(
      s,
      "const m=L.marker(c,{icon:pinIcon,title:j.title||'Job'});",
      "const m=L.marker(c,{icon:fresh3(j)?freshPinIcon:pinIcon,title:j.title||'Job'});",
      'farbiger NEU-Marker'
    );
  }

  await fs.writeFile(APP,s);
}

async function patchIndex(){
  let s=await fs.readFile(INDEX,'utf8');
  if(!s.includes('./fresh-highlights.css')){
    s=mustReplace(s,'  <link rel="stylesheet" href="./new-jobs.css">','  <link rel="stylesheet" href="./new-jobs.css">\n  <link rel="stylesheet" href="./fresh-highlights.css">','Highlight-CSS im HTML');
  }
  await fs.writeFile(INDEX,s);
}

async function writeCss(){
  const css=`/* Neue Jobs: für 72 Stunden unabhängig vom Popup-Lesestatus hervorheben */
.job-card.fresh-job-card{border-color:rgba(255,190,76,.55);background:linear-gradient(90deg,rgba(255,174,58,.105),rgba(255,255,255,.026) 42%);box-shadow:inset 3px 0 0 #ffb13b,0 7px 22px rgba(255,150,45,.06)}
.job-card.fresh-job-card:hover,.job-card.fresh-job-card.selected{border-color:rgba(255,201,102,.78);background:linear-gradient(90deg,rgba(255,174,58,.16),var(--panel-2) 48%)}
.fresh-new-badge{color:#ffe2a0!important;border-color:rgba(255,184,66,.58)!important;background:rgba(255,166,46,.16)!important;box-shadow:0 0 0 1px rgba(255,184,66,.08),0 0 15px rgba(255,157,49,.12)}
.job-pin.fresh-job-pin{width:33px;height:33px;background:linear-gradient(135deg,#ffd35a,#ff7f3f);border-color:#fff3c4;box-shadow:0 0 0 5px rgba(255,178,55,.18),0 5px 18px rgba(0,0,0,.42);animation:freshJobPulse 1.8s ease-in-out infinite}
.job-pin.fresh-job-pin span{font-size:10px;font-weight:950;color:#2a1600}
@keyframes freshJobPulse{0%,100%{box-shadow:0 0 0 4px rgba(255,178,55,.15),0 5px 18px rgba(0,0,0,.42)}50%{box-shadow:0 0 0 9px rgba(255,178,55,.03),0 5px 22px rgba(255,142,47,.28)}}
@media(max-width:850px){.job-card.fresh-job-card{box-shadow:inset 3px 0 0 #ffb13b}.job-pin.fresh-job-pin{animation:none}}
`;
  await fs.writeFile(CSS,css);
}

async function patchSw(){
  let s=await fs.readFile(SW,'utf8');
  s=s.replace(/job-radar-v\d+/g,'job-radar-v5');
  if(!s.includes("'./fresh-highlights.css'")){
    s=mustReplace(s,"'./new-jobs.css'","'./new-jobs.css','./fresh-highlights.css'",'Highlight-CSS im PWA-Cache');
  }
  await fs.writeFile(SW,s);
}

await patchApp();
await patchIndex();
await writeCss();
await patchSw();
console.log('3-Tage-NEU-Hervorhebung aktiv: Karte farbig, NEU-Badge und bei Alle zuerst.');
