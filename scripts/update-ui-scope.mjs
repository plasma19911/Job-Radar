import fs from 'node:fs/promises';

const files=['public/app.js','public/index.html','public/manifest.webmanifest'];
for(const file of files){
  let s=await fs.readFile(file,'utf8');
  s=s.replace(/RADIUS_KM=15/g,'RADIUS_KM=10')
     .replace(/15-km/g,'10-km')
     .replace(/15 km/g,'10 km')
     .replace(/15-km-Bereich/g,'10-km-Bereich')
     .replace(/localWithin15km/g,'localWithin10km')
     .replace(/Job Radar – 10 km \+ Homeoffice/g,'Job Radar – Büro & PC · 10 km + Homeoffice')
     .replace(/10 km \+ 100 % Homeoffice/g,'Büro & PC · 10 km + 100 % Homeoffice')
     .replace(/10 km oder reines Homeoffice/g,'Büro/PC bis 10 km oder reines Homeoffice')
     .replace(/(?:Büro & PC · )+10 km \+ 100 % Homeoffice/g,'Büro & PC · 10 km + 100 % Homeoffice')
     .replace(/(?:Büro\/PC bis )+10 km oder reines Homeoffice/g,'Büro/PC bis 10 km oder reines Homeoffice');
  await fs.writeFile(file,s);
}
let sw=await fs.readFile('public/sw.js','utf8');
sw=sw.replace(/job-radar-v\d+/g,'job-radar-v5');
await fs.writeFile('public/sw.js',sw);
console.log('Oberfläche auf Büro/PC, 10 km und PWA-Cache v5 aktualisiert.');
