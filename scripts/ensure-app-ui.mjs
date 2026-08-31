import fs from 'node:fs/promises';

// Letzter Schritt jedes Scans: 15-km-App-Layout, Polish und PWA-Dateien dauerhaft erhalten.
const INDEX='public/index.html';
const SW='public/sw.js';

let index=await fs.readFile(INDEX,'utf8');
if(!index.includes('./readable-ui.css')){
  index=index.replace('  <link rel="stylesheet" href="./fresh-highlights.css">','  <link rel="stylesheet" href="./fresh-highlights.css">\n  <link rel="stylesheet" href="./readable-ui.css">');
}
if(!index.includes('./polish.css')){
  index=index.replace('  <link rel="stylesheet" href="./readable-ui.css">','  <link rel="stylesheet" href="./readable-ui.css">\n  <link rel="stylesheet" href="./polish.css">');
}
if(!index.includes('./pwa-install.js')){
  index=index.replace('  <script type="module" src="./new-jobs.js"></script>','  <script type="module" src="./new-jobs.js"></script>\n  <script type="module" src="./pwa-install.js"></script>');
}
await fs.writeFile(INDEX,index);

let sw=await fs.readFile(SW,'utf8');
sw=sw.replace(/job-radar-v\d+/g,'job-radar-v8');
if(!sw.includes("'./readable-ui.css'")) sw=sw.replace("'./fresh-highlights.css'","'./fresh-highlights.css','./readable-ui.css'");
if(!sw.includes("'./polish.css'")) sw=sw.replace("'./readable-ui.css'","'./readable-ui.css','./polish.css'");
if(!sw.includes("'./favorite-store.js'")) sw=sw.replace("'./new-jobs.js'","'./new-jobs.js','./favorite-store.js'");
if(!sw.includes("'./pwa-install.js'")) sw=sw.replace("'./favorite-store.js'","'./favorite-store.js','./pwa-install.js'");
if(!sw.includes("'./icons/icon-maskable.svg'")) sw=sw.replace("'./icons/icon.svg'","'./icons/icon.svg','./icons/icon-maskable.svg'");
await fs.writeFile(SW,sw);

console.log('Vollständiger 15-km-App-Stand inkl. polish.css, Favoriten und PWA-Cache v8 sichergestellt.');
