import fs from 'node:fs/promises';

const OUT='public/data/jobs.json';

function norm(v=''){
  return String(v??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß%]+/g,' ').replace(/\s+/g,' ').trim();
}

function isExcluded(job){
  const title=norm(job.title||'');
  const types=norm(Array.isArray(job.employmentType)?job.employmentType.join(' '):job.employmentType||'');
  const text=`${title} ${types}`;
  return /(werkstudent|werkstudentin|werkstudierende|working student|studentische hilfskraft|student assistant|praktikum|praktikant|praktikantin|praktikumsplatz|internship|\bintern\b|trainee internship)/i.test(text);
}

async function main(){
  const payload=JSON.parse(await fs.readFile(OUT,'utf8'));
  const before=Array.isArray(payload.jobs)?payload.jobs.length:0;
  payload.jobs=(payload.jobs||[]).filter(j=>!isExcluded(j));
  payload.meta=payload.meta||{};
  payload.meta.generatedAt=new Date().toISOString();
  payload.meta.total=payload.jobs.length;
  payload.meta.excludedWorkingStudent=true;
  payload.meta.excludedInternships=true;
  payload.meta.excludedUnwantedThisRun=before-payload.jobs.length;
  await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');
  console.log(`Werkstudent/Praktikum filter: ${before} -> ${payload.jobs.length}; removed ${before-payload.jobs.length}`);
}

main().catch(e=>{console.error(e);process.exit(1);});
