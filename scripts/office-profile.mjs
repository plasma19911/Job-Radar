import fs from 'node:fs/promises';

const OUT='public/data/jobs.json';
// Zielprofil: lokale Büro-/PC-Tätigkeiten ohne körperlich schwere Arbeit; reine Remote-Jobs bleiben zulässig.

function norm(v=''){
  return String(v??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß]+/g,' ').replace(/\s+/g,' ').trim();
}

const OFFICE=/(sachbearbeit|büro|buero|office|backoffice|back office|verwaltung|verwaltungs|administrat|assistenz|assistant|sekret|empfang|rezeption|reception|kundenservice|customer service|customer support|kundenbetreu|servicecenter|service center|call center|telefon|disponent|disposition|koordinator|koordination|buchhalt|accounting|finance|finanz|controlling|personal|human resources|hr |recruit|payroll|lohn|gehalt|einkauf|procurement|vertriebsinnendienst|inside sales|sales support|auftragssachbearbeit|auftragsbearbeit|datenpflege|data entry|datenerfass|stammdaten|support|helpdesk|help desk|it support|software|developer|entwickler|programm|digital|online|content|marketing|kommunikation|projektassist|projektkoordination|projektmanagement|project management|bank|versicherung|versicherungs|immobilienverwaltung|property management|termin|planung|planer|document control|dokumentation|qualitätsmanagement|qualitaetsmanagement|compliance|legal|recht|e commerce|ecommerce|crm|sap|excel|microsoft office|kaufmänn|kaufmaenn)/i;
const PHYSICAL=/(lager|kommission|packer|verpacker|produktion|produktionsmitarbeiter|fertigung|montage|monteur|reinigung|reiniger|pflegefach|pflegehelfer|altenpflege|krankenpflege|erzieher|fahrer|fahrerin|zusteller|kurier|lieferfahrer|handwerker|elektriker|mechaniker|mechatroniker|schlosser|schweißer|schweisser|installateur|techniker im außendienst|techniker im aussendienst|bauarbeiter|baustelle|tiefbau|hochbau|maurer|dachdecker|gärtner|gaertner|hausmeister|security|sicherheitsmitarbeiter|wachschutz|küche|kueche|koch|köchin|baecker|bäcker|fleischer|metzger|servicekraft|kellner|verkäufer|verkaeufer|kassierer|warenverräum|warenverraeum|logistikmitarbeiter|pförtner|pfoertner)/i;

function officeFit(job){
  if(job.remoteFull===true)return true;
  const title=norm(job.title||'');
  const types=norm(Array.isArray(job.employmentType)?job.employmentType.join(' '):job.employmentType||'');
  const desc=norm((job.description||'').slice(0,3000));
  const text=`${title} ${types} ${desc}`;
  if(PHYSICAL.test(title) && !OFFICE.test(title))return false;
  return OFFICE.test(text);
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));
  const before=(payload.jobs||[]).length;
  payload.jobs=(payload.jobs||[]).filter(officeFit);
  payload.meta=payload.meta||{};
  payload.meta.generatedAt=new Date().toISOString();
  payload.meta.total=payload.jobs.length;
  payload.meta.officePcProfile=true;
  payload.meta.excludedPhysicalHeavy=true;
  payload.meta.officeProfileRemoved=before-payload.jobs.length;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');
  console.log(`Büro/PC-Profil: ${before} -> ${payload.jobs.length}; entfernt ${before-payload.jobs.length}`);
}

main().catch(e=>{console.error(e);process.exit(1);});
