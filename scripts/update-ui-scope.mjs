import fs from 'node:fs/promises';

const files=['public/app.js','public/index.html','public/manifest.webmanifest'];
for(const file of files){
  let s=await fs.readFile(file,'utf8');
  s=s.replace(/RADIUS_KM=15/g,'RADIUS_KM=10')
     .replace(/15-km/g,'10-km')
     .replace(/15 km/g,'10 km')
     .replace(/15-km-Bereich/g,'10-km-Bereich')
     .replace(/localWithin15km/g,'localWithin10km');
  await fs.writeFile(file,s);
}
console.log('Oberfläche auf 10 km aktualisiert.');
