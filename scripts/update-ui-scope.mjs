import fs from 'node:fs/promises';

const files=['public/app.js','public/index.html','public/manifest.webmanifest','public/new-jobs.js'];
for(const file of files){
  let s=await fs.readFile(file,'utf8');
  s=s.replace(/RADIUS_KM=10/g,'RADIUS_KM=15')
     .replace(/10-km/g,'15-km')
     .replace(/10 km/g,'15 km')
     .replace(/10-km-Bereich/g,'15-km-Bereich')
     .replace(/localWithin10km/g,'localWithin15km')
     .replace(/Job Radar – Büro & PC · 10 km \+ Homeoffice/g,'Job Radar – Büro & PC · 15 km + Homeoffice')
     .replace(/Büro & PC · 10 km \+ 100 % Homeoffice/g,'Büro & PC · 15 km + 100 % Homeoffice')
     .replace(/Büro\/PC bis 10 km oder reines Homeoffice/g,'Büro/PC bis 15 km oder reines Homeoffice')
     .replace(/bis 10 km/g,'bis 15 km');
  await fs.writeFile(file,s);
}
let sw=await fs.readFile('public/sw.js','utf8');
sw=sw.replace(/job-radar-v\d+/g,'job-radar-v8');
await fs.writeFile('public/sw.js',sw);
console.log('Oberfläche auf Büro/PC, 15 km und PWA-Cache v8 aktualisiert.');
