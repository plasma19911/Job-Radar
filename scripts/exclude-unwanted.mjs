import fs from 'node:fs/promises';

const OUT='public/data/jobs.json';
// Endgültiger Ausschlussfilter: keine Senior-, Werkstudenten-, Praktikums- oder Zeitarbeitsstellen.

function norm(v=''){
  return String(v??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß%]+/g,' ').replace(/\s+/g,' ').trim();
}

const TEMP_AGENCY_COMPANIES=/\b(randstad|adecco|manpower|tempton|arwa|orizon|dis ag|persona service|piening|iperdi|gi group|office people|unique personalservice|alphaconsult|akzent personalkontor|akzent personal|dekra arbeit|runtime personal|perzukunft|persona plan|persona data|bindan|expertum|pluss personalmanagement|avanti|zam personal|meteor personaldienste|tabel personalberatung|timepartner|hanfried|jobactive|worx personalmanagement|allmedi personal|persona part|persona service)\b/i;
const TEMP_WORK_TERMS=/\b(zeitarbeit|zeitarbeitsfirma|zeitarbeitsunternehmen|leiharbeit|leiharbeiter|arbeitnehmeruberlassung|arbeitnehmerüberlassung|personaluberlassung|personalüberlassung|personaldienstleister|personaldienstleistung|personaldienstleistungen|temporary staffing|staffing agency|temp agency)\b/i;

function isExcluded(job){
  const title=norm(job.title||'');
  const types=norm(Array.isArray(job.employmentType)?job.employmentType.join(' '):job.employmentType||'');
  const company=norm(job.company||'');
  const description=norm(job.description||'');
  const source=norm(job.source||'');
  const text=`${title} ${types}`;
  const staffingText=`${title} ${company} ${description.slice(0,1800)} ${source}`;

  // Seniorität nur anhand des Jobtitels prüfen, damit harmlose Erwähnungen in Beschreibungen nicht aussortieren.
  if(/\bsenior|\bsr\b/i.test(title))return true;

  if(/(werkstudent|werkstudentin|werkstudierende|working student|studentische hilfskraft|student assistant|praktikum|praktikant|praktikantin|praktikumsplatz|internship|\bintern\b|trainee internship)/i.test(text))return true;
  if(TEMP_WORK_TERMS.test(staffingText))return true;
  if(TEMP_AGENCY_COMPANIES.test(company))return true;
  return false;
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));
  const before=Array.isArray(payload.jobs)?payload.jobs.length:0;
  payload.jobs=(payload.jobs||[]).filter(j=>!isExcluded(j));
  payload.meta=payload.meta||{};
  payload.meta.generatedAt=new Date().toISOString();
  payload.meta.total=payload.jobs.length;
  payload.meta.excludedSeniorJobs=true;
  payload.meta.excludedWorkingStudent=true;
  payload.meta.excludedInternships=true;
  payload.meta.excludedTemporaryWork=true;
  payload.meta.excludedUnwantedThisRun=before-payload.jobs.length;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');
  console.log(`Ausschlussfilter Senior/Werkstudent/Praktikum/Zeitarbeit: ${before} -> ${payload.jobs.length}; removed ${before-payload.jobs.length}`);
}

main().catch(e=>{console.error(e);process.exit(1);});
