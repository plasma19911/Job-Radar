import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Offizielle Portal-APIs als Ersatz fuer die Seiten, die Scraper mit 403 abweisen.
// Alle Quellen sind schluesselgesteuert: fehlt der Key, wird die Quelle uebersprungen
// und der Lauf geht normal weiter.
//
//   JOOBLE_API_KEY     -> https://jooble.org/api/about        (kostenlos, ersetzt das Jooble-Scraping)
//   CAREERJET_AFFID    -> https://www.careerjet.de/partners/  (kostenlos, breiter Aggregator)
//   ADZUNA_APP_ID/KEY  -> https://developer.adzuna.com/       (kostenlos, bereits in update-jobs.mjs verdrahtet)

const OUT = 'public/data/jobs.json';
const UA = 'Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)';

const HOME_CITY = 'Berlin Spandau';
const RADIUS_KM = 15;
const TERMS = [
  'Sachbearbeiter', 'Bürokauffrau', 'Assistenz', 'Kundenservice', 'Buchhaltung',
  'Verwaltung', 'Backoffice', 'Datenerfassung', 'Vertriebsinnendienst', 'Teamassistenz'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = v => clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9äöüß]+/g, ' ').replace(/\s+/g, ' ').trim();
const hash = v => crypto.createHash('sha1').update(String(v)).digest('hex').slice(0, 18);
const strip = v => clean(String(v ?? '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'));

async function req(url, { method = 'GET', body = null, headers = {} } = {}) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 25000);
  try {
    const r = await fetch(url, {
      method,
      headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9', ...headers },
      body,
      signal: c.signal
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function employmentFromText(text = '') {
  const n = norm(text);
  const out = [];
  if (/vollzeit|full time/.test(n)) out.push('Vollzeit');
  if (/teilzeit|part time/.test(n)) out.push('Teilzeit');
  if (/minijob|geringfugig/.test(n)) out.push('Minijob');
  return out;
}

function looksFullRemote(text = '') {
  const n = norm(text);
  if (/hybrid|teilweise|gelegentlich|tage pro woche/.test(n)) return false;
  return /(100 ?% ?(remote|homeoffice)|vollstandig remote|komplett remote|fully remote|reines homeoffice|ausschliesslich homeoffice|ortsunabhangig)/.test(n);
}

// --- Jooble ----------------------------------------------------------------
async function fetchJooble() {
  const key = process.env.JOOBLE_API_KEY;
  const name = 'Jooble API';
  if (!key) return { name, jobs: [], status: 'skipped', note: 'JOOBLE_API_KEY fehlt' };
  const jobs = [];
  const seen = new Set();
  for (const keywords of TERMS) {
    for (let page = 1; page <= 2; page++) {
      let data;
      try {
        data = await req(`https://de.jooble.org/api/${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords, location: HOME_CITY, radius: String(RADIUS_KM), page: String(page) })
        });
      } catch (e) { console.warn(`[${name}] ${keywords} S.${page}: ${e.message}`); break; }
      const rows = data.jobs || [];
      if (!rows.length) break;
      for (const o of rows) {
        const url = o.link;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const desc = strip(o.snippet);
        jobs.push({
          id: `jooble-${hash(o.id || url)}`,
          title: clean(o.title), company: clean(o.company),
          location: clean(o.location), address: '',
          lat: null, lon: null,
          remote: looksFullRemote(`${o.title} ${desc}`),
          remoteFull: looksFullRemote(`${o.title} ${desc}`) || undefined,
          employmentType: employmentFromText(`${o.type} ${desc}`),
          publishedAt: o.updated || null, validThrough: null,
          url, source: name, sources: [{ name, url }],
          description: desc.slice(0, 6500),
          salary: clean(o.salary) || null
        });
      }
      await sleep(250);
    }
  }
  return { name, jobs, status: 'ok' };
}

// --- Careerjet -------------------------------------------------------------
async function fetchCareerjet() {
  const affid = process.env.CAREERJET_AFFID;
  const name = 'Careerjet API';
  if (!affid) return { name, jobs: [], status: 'skipped', note: 'CAREERJET_AFFID fehlt' };
  const jobs = [];
  const seen = new Set();
  for (const keywords of TERMS) {
    for (let page = 1; page <= 2; page++) {
      const u = new URL('https://public.api.careerjet.net/search');
      Object.entries({
        locale_code: 'de_DE', keywords, location: HOME_CITY, radius: String(RADIUS_KM),
        sort: 'date', pagesize: '50', page: String(page), affid,
        user_ip: '1.1.1.1', user_agent: UA
      }).forEach(([k, v]) => u.searchParams.set(k, v));
      let data;
      try { data = await req(u); }
      catch (e) { console.warn(`[${name}] ${keywords} S.${page}: ${e.message}`); break; }
      if (data.type !== 'JOBS') break;
      const rows = data.jobs || [];
      if (!rows.length) break;
      for (const o of rows) {
        const url = o.url;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const desc = strip(o.description);
        const full = looksFullRemote(`${o.title} ${desc}`);
        jobs.push({
          id: `careerjet-${hash(url)}`,
          title: clean(o.title), company: clean(o.company),
          location: clean(o.locations), address: '',
          lat: null, lon: null,
          remote: full, remoteFull: full || undefined,
          employmentType: employmentFromText(desc),
          publishedAt: o.date || null, validThrough: null,
          url, source: name, sources: [{ name, url }],
          description: desc.slice(0, 6500),
          salary: clean(o.salary) || null
        });
      }
      if (rows.length < 50) break;
      await sleep(250);
    }
  }
  return { name, jobs, status: 'ok' };
}

// --- Zusammenfuehren -------------------------------------------------------
function companyNorm(v = '') {
  return norm(v).replace(/\b(gmbh|mbh|ag|kg|ohg|ug|gbr|se|co|gruppe|group|deutschland)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(v = '') {
  return new Set(norm(v).split(' ').filter(x => x.length > 2 && !['der', 'die', 'das', 'und', 'fur', 'als', 'mit', 'bei', 'von', 'mwd'].includes(x)));
}
function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.max(A.size, B.size);
}
function same(a, b) {
  if (a.url && b.url && a.url === b.url) return true;
  const ac = companyNorm(a.company), bc = companyNorm(b.company);
  if (!ac || !bc) return false;
  if (ac !== bc && !(ac.includes(bc) || bc.includes(ac))) return false;
  return norm(a.title) === norm(b.title) || similarity(a.title, b.title) >= 0.75;
}

async function main() {
  const payload = JSON.parse(await fs.readFile(OUT, 'utf8'));
  payload.jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  payload.meta = payload.meta || {};
  payload.meta.sources = Array.isArray(payload.meta.sources) ? payload.meta.sources : [];

  for (const fn of [fetchJooble, fetchCareerjet]) {
    let r;
    try { r = await fn(); }
    catch (e) { r = { name: fn.name, jobs: [], status: 'error', note: e.message.slice(0, 100) }; }

    let added = 0, merged = 0;
    for (const job of r.jobs) {
      if (!job.title) continue;
      const hit = payload.jobs.find(x => same(x, job));
      if (hit) {
        merged++;
        hit.sources = Array.isArray(hit.sources) ? hit.sources : [];
        if (!hit.sources.some(s => s.url === job.url)) hit.sources.push({ name: r.name, url: job.url });
        if (!hit.salary && job.salary) hit.salary = job.salary;
        if ((job.description || '').length > (hit.description || '').length) hit.description = job.description;
        continue;
      }
      payload.jobs.push(job);
      added++;
    }

    const entry = { name: r.name, count: added, status: r.status };
    if (r.note) entry.note = r.note;
    const existing = payload.meta.sources.find(x => x.name === r.name);
    if (existing) Object.assign(existing, entry); else payload.meta.sources.push(entry);
    console.log(`[${r.name}] ${r.status}${r.note ? ` (${r.note})` : ''}: ${added} neu, ${merged} zusammengeführt`);
  }

  payload.meta.generatedAt = new Date().toISOString();
  payload.meta.total = payload.jobs.length;
  await fs.writeFile(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Portal-APIs fertig. Gesamt ${payload.jobs.length}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
