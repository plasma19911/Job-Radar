const CACHE='job-radar-v7';
const SHELL=['./','./index.html','./styles.css','./fixed.css','./new-jobs.css','./fresh-highlights.css','./readable-ui.css','./app.js','./new-jobs.js','./favorite-store.js','./pwa-install.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-maskable.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.pathname.endsWith('/data/jobs.json')||url.pathname.endsWith('data/jobs.json')){
    event.respondWith(fetch(event.request).catch(()=>caches.match(event.request))); return;
  }
  if(event.request.method!=='GET') return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(res=>{if(url.origin===location.origin){const copy=res.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}return res;})));
});
