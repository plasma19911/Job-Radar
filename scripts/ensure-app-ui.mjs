import fs from 'node:fs/promises';

const INDEX='public/index.html';
const SW='public/sw.js';

let index=await fs.readFile(INDEX,'utf8');
if(!index.includes('./readable-ui.css')){
  index=index.replace('  <link rel="stylesheet" href="./fresh-highlights.css">','  <link rel="stylesheet" href="./fresh-highlights.css">\n  <link rel="stylesheet" href="./readable-ui.css">');
}
if(!index.includes('./pwa-install.js')){
  index=index.replace('  <script type="module" src="./new-jobs.js"></script>','  <script type="module" src="./new-jobs.js"></script>\n  <script type="module" src="./pwa-install.js"></script>');
}
await fs.writeFile(INDEX,index);

let sw=await fs.readFile(SW,'utf8');
sw=sw.replace(/job-radar-v\d+/g,'job-radar-v6');
if(!sw.includes("'./readable-ui.css'")) sw=sw.replace("'./fresh-highlights.css'","'./fresh-highlights.css','./readable-ui.css'");
if(!sw.includes("'./pwa-install.js'")) sw=sw.replace("'./new-jobs.js'","'./new-jobs.js','./pwa-install.js'");
if(!sw.includes("'./icons/icon-maskable.svg'")) sw=sw.replace("'./icons/icon.svg'","'./icons/icon.svg','./icons/icon-maskable.svg'");
await fs.writeFile(SW,sw);

console.log('Lesbares Handy-App-UI und PWA-Cache v6 sichergestellt.');
