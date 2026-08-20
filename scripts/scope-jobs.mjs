import fs from 'node:fs/promises';

// Finale Sichtbarkeit:
// - lokale Stellen bis 10 km
// - 100-%-Homeoffice nur, wenn die Stelle klar Deutschland zugeordnet ist
//   und die Anzeige nicht rein englisch ist.
const OUT='public/data/jobs.json';
const ADDRESS='Marwitzer Str. 67, 13589 Berlin';
const FALLBACK=[52.5804,13.1729];
const RADIUS=10;
const UA='Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';

const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß]+/g,' ').replace(/\s+/g,' ').trim();

function km(a,b){const R=6371,r=x=>x*Math.PI/180,dLat=r(b[0]-a[0]),dLon=r(b[1]-a[1]),q=Math.sin(dLat/2)**2+Math.cos(r(a[0]))*Math.cos(r(b[0]))*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));}
function coords(j){return Number.isFinite(j.lat)&&Number.isFinite(j.lon)?[j.lat,j.lon]:null;}
async function center(){try{const u=new URL('https://nominatim.openstreetmap.org/search');u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('countrycodes','de');u.searchParams.set('q',ADDRESS);const r=await fetch(u,{headers:{'User-Agent':UA,'Accept-Language':'de-DE'}});if(r.ok){const d=await r.json();if(d[0])return[+d[0].lat,+d[0].lon];}}catch{}return FALLBACK;}

// Breite Europa-/Weltweit-Angaben gelten ausdrücklich NICHT als Deutschland-Nachweis.
const BROAD_REMOTE_RE=/\b(europe|europa|emea|worldwide|world wide|global|anywhere|anywhere in the world|remote worldwide|remote europe|eu remote)\b/i;
const FOREIGN_COUNTRY_RE=/\b(austria|österreich|switzerland|schweiz|france|frankreich|spain|spanien|italy|italien|netherlands|niederlande|belgium|belgien|poland|polen|czech|tschechien|portugal|ireland|irland|united kingdom|uk|great britain|großbritannien|usa|united states|canada|kanada|india|indien|singapore|singapur|australia|australien|denmark|dänemark|sweden|schweden|norway|norwegen|finland|finnland|romania|rumänien|hungary|ungarn|greece|griechenland|turkey|türkei)\b/i;
const GERMANY_RE=/\b(deutschland|germany|deutschlandweit|bundesweit|bundesweit remote|remote in deutschland|remote deutschland|homeoffice deutschland|wohnort deutschland|arbeitsort deutschland|standort deutschland|german based|based in germany|within germany|anywhere in germany)\b/i;
const GERMAN_CITY_RE=/\b(berlin|hamburg|münchen|munchen|köln|koln|frankfurt|stuttgart|düsseldorf|dusseldorf|dortmund|essen|leipzig|bremen|dresden|hannover|nürnberg|nurnberg|duisburg|bochum|wuppertal|bielefeld|bonn|münster|munster|karlsruhe|mannheim|augsburg|wiesbaden|gelsenkirchen|mönchengladbach|monchengladbach|braunschweig|chemnitz|kiel|aachen|halle|magdeburg|freiburg|krefeld|lübeck|lubeck|mainz|erfurt|rostock|kassel|potsdam|saarbrücken|saarbrucken|falkensee|hennigsdorf)\b/i;
const GERMAN_LEGAL_RE=/\b(gmbh|mbh|ug(?: haftungsbeschränkt| haftungsbeschrankt)?|gmbh\s*&\s*co\.?\s*kg|e\.?\s*v\.?|e\.?\s*k\.?)\b/i;

function remoteGermanyEvidence(j){
  const location=clean(`${j.location||''} ${j.address||''}`);
  const text=clean(`${location} ${j.company||''} ${j.title||''} ${(j.description||'').slice(0,5000)}`);
  const source=clean(j.source||'');

  // Alte Arbeitnow-Daten hatten bei leerem Ort künstlich "Deutschland / Remote".
  // Diese Zeichenfolge darf allein nicht als Deutschland-Nachweis gelten.
  const fakeArbeitnowDefault=/^deutschland\s*\/\s*remote$/i.test(location)&&/arbeitnow/i.test(source);

  if(FOREIGN_COUNTRY_RE.test(location)&&!GERMANY_RE.test(location))return false;
  if(!fakeArbeitnowDefault&&GERMANY_RE.test(location))return true;
  if(GERMAN_CITY_RE.test(location)||/\b\d{5}\b/.test(location))return true;
  if(GERMAN_LEGAL_RE.test(j.company||''))return true;

  // Beschreibung darf Deutschland belegen; bloß Europe/EMEA/Worldwide aber nicht.
  if(GERMANY_RE.test(text))return true;
  if(BROAD_REMOTE_RE.test(location))return false;
  return false;
}

const GERMAN_STRONG_RE=/\b(sachbearbeit\w*|kaufmänn\w*|kaufmaenn\w*|buchhalt\w*|verwaltung\w*|kundenservice|vertriebsinnendienst|assistenz|stellenbeschreibung|bewerbung|bewerben|arbeitszeit|arbeitgeber|mitarbeiter\w*|aufgaben|anforderungen|kenntnisse|berufserfahrung|homeoffice|deutschkenntnisse)\b/i;
const GERMAN_WORDS=['und','der','die','das','den','dem','des','für','mit','wir','du','dein','deine','sie','ihnen','bei','auf','von','oder','sowie','eine','einen','einer','unser','unsere','bieten','suchen','erfahrung','kenntnisse','aufgaben','profil','bewerbung','deutsch','deutsche','deutschland','arbeitszeit','arbeit','team'];

function notEnglishOnly(j){
  const title=clean(j.title||'');
  const description=clean(j.description||'').slice(0,6500);
  const text=norm(`${title} ${description}`);
  if(!text)return false;

  // Ein klar deutscher Berufstitel/Text reicht bereits.
  if(GERMAN_STRONG_RE.test(`${title} ${description}`))return true;
  if(/[äöüß]/i.test(`${title} ${description}`))return true;

  const tokens=new Set(text.split(' ').filter(Boolean));
  let hits=0;
  for(const w of GERMAN_WORDS)if(tokens.has(norm(w)))hits++;
  return hits>=3;
}

function remoteAllowed(j){return remoteGermanyEvidence(j)&&notEnglishOnly(j);}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));
  const c=await center();
  const before=payload.jobs.length;
  let remoteForeignOrUnclear=0,remoteEnglishOnly=0;

  payload.jobs=payload.jobs.filter(j=>{
    if(j.remoteFull===true){
      if(!remoteGermanyEvidence(j)){remoteForeignOrUnclear++;return false;}
      if(!notEnglishOnly(j)){remoteEnglishOnly++;return false;}
      return true;
    }
    const p=coords(j);
    return Boolean(p&&km(c,p)<=RADIUS);
  });

  payload.jobs.sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0));
  payload.meta=payload.meta||{};
  payload.meta.generatedAt=new Date().toISOString();
  payload.meta.total=payload.jobs.length;
  payload.meta.scope={
    address:ADDRESS,
    radiusKm:RADIUS,
    pureHomeofficeGermanyOnly:true,
    excludeEnglishOnlyRemote:true,
    center:{lat:c[0],lon:c[1]}
  };
  payload.meta.localWithin10km=payload.jobs.filter(j=>j.remoteFull!==true).length;
  delete payload.meta.localWithin15km;
  payload.meta.remoteFull=payload.jobs.filter(j=>j.remoteFull===true).length;
  payload.meta.remoteFiltered={foreignOrNoGermanyEvidence:remoteForeignOrUnclear,englishOnly:remoteEnglishOnly};
  payload.meta.trainingOffers=false;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');
  console.log(`Scope: ${before} -> ${payload.jobs.length}; local ${payload.meta.localWithin10km}; pure remote DE/non-English ${payload.meta.remoteFull}; remote Ausland/unklar entfernt ${remoteForeignOrUnclear}; rein englisch entfernt ${remoteEnglishOnly}`);
}
main().catch(e=>{console.error(e);process.exit(1);});
