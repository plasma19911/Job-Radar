import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Zusatzquelle: Bundesagentur für Arbeit, aber pro Nachbarort einzeln.
// Grund: eine einzelne Umkreissuche liefert über die Seitenzahl nur einen
// Ausschnitt der Treffer. Mehrere kleine Suchmittelpunkte holen deutlich mehr
// Stellen aus genau dem Bereich, der für die feste Adresse relevant ist.

const OUT = 'public/data/jobs.json';
const BASE = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs';
const KEY = 'jobboerse-jobsuche';
const SOURCE = 'Bundesagentur Umkreis-Orte';
const DAYS = '28';

// Orte im 15-km-Bereich um Marwitzer Str. 67, 13589 Berlin.
const PLACES = [
  { wo: '13589 Berlin', umkreis: '7' },
  { wo: '13593 Berlin', umkreis: '7' },    // Staaken / Wilhelmstadt
  { wo: '13581 Berlin', umkreis: '7' },    // Spandau Altstadt
  { wo: '13507 Berlin', umkreis: '7' },    // Tegel
  { wo: '13629 Berlin', umkreis: '7' },    // Siemensstadt
  { wo: '14612 Falkensee', umkreis: '7' },
  { wo: '16761 Hennigsdorf', umkreis: '7' },
  { wo: '16727 Velten', umkreis: '7' },
  { wo: '14641 Wustermark', umkreis: '7' },
  { wo: '14624 Dallgow-Döberitz', umkreis: '7' },
  { wo: '14621 Schönwalde-Glien', umkreis: '7' },
  { wo: '14656 Brieselang', umkreis: '7' },
  { wo: '16540 Hohen Neuendorf', umkreis: '7' }
];

// Büro-/PC-nahe Suchbegriffe. Serverseitig gefiltert = weniger Ballast.
const TERMS = [
  'Sachbearbeiter', 'Bürokauffrau', 'Kaufmännischer Mitarbeiter', 'Assistenz',
  'Sekretariat', 'Kundenservice', 'Buchhaltung', 'Steuerfachangestellte',
  'Verwaltungsfachangestellte', 'Personalsachbearbeiter', 'Datenerfassung',
  'Auftragssachbearbeitung', 'Vertriebsinnendienst', 'Disponent',
  'Hausverwaltung', 'Backoffice', 'Teamassistenz', 'Empfang', 'IT-Support'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = v => clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9äöüß]+/g, ' ').replace(/\s+/g, ' ').trim();
const hash = v => crypto.createHash('sha1').update(String(v)).digest('hex').slice(0, 18);

async function api(params) {
  const u = new URL(BASE);
  Object.entries({ angebotsart: '1', size: '100', pav: 'false', ...params })
    .forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v)); });
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 25000);
  try {
    const r = await fetch(u, { headers: { 'X-API-Key': KEY, 'User-Agent': 'Job-Radar/1.0 (+https://github.com/plasma19911/Job-Radar)' }, signal: c.signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function search(params, maxPages = 2) {
  const rows = [];
  for (let page = 1; page <= maxPages; page++) {
    let data;
    try { data = await api({ ...params, page: String(page) }); }
    catch (e) { console.warn(`[${SOURCE}] ${params.wo} / ${params.was || 'alle'} S.${page}: ${e.message}`); break; }
    const list = data.ergebnisliste || [];
    if (!list.length) break;
    rows.push(...list);
    if (list.length < 100) break;
    await sleep(130);
  }
  return rows;
}

function employmentType(o) {
  const out = [];
  if (o.arbeitszeitVollzeit) out.push('Vollzeit');
  if (o.arbeitszeitTeilzeitVormittag || o.arbeitszeitTeilzeitNachmittag || o.arbeitszeitTeilzeitAbend || o.arbeitszeitTeilzeitFlexibel) out.push('Teilzeit');
  if (o.istGeringfuegigeBeschaeftigung) out.push('Minijob');
  if (o.homeofficemoeglich) out.push('Homeoffice möglich');
  return out;
}

function toJob(o) {
  const loc = (o.stellenlokationen && o.stellenlokationen[0]) || {};
  const adr = loc.adresse || {};
  const ref = o.referenznummer || o.refnr;
  const url = o.externeURL || o.externeUrl ||
    (ref ? `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(ref)}` : null);
  if (!url) return null;
  const lat = Number(loc.breite), lon = Number(loc.laenge);
  return {
    id: `ba-orte-${hash(ref || url)}`,
    title: clean(o.stellenangebotsTitel || o.hauptberuf),
    company: clean(o.firma || ''),
    location: clean([adr.plz, adr.ort].filter(Boolean).join(' ')),
    address: clean([adr.strasse, adr.plz, adr.ort].filter(Boolean).join(', ')),
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    remote: Boolean(o.homeofficemoeglich),
    employmentType: employmentType(o),
    publishedAt: o.datumErsteVeroeffentlichung || o.veroeffentlichungszeitraum?.von || null,
    validThrough: null,
    url,
    source: SOURCE,
    sources: [{ name: SOURCE, url }],
    description: '',
    salary: null
  };
}

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

  const seen = new Set();
  const collected = [];
  for (const place of PLACES) {
    let hits = 0;
    for (const was of TERMS) {
      for (const raw of await search({ ...place, was, veroeffentlichtseit: DAYS }, 2)) {
        const ref = raw.referenznummer || raw.refnr;
        if (ref && seen.has(ref)) continue;
        if (ref) seen.add(ref);
        const job = toJob(raw);
        if (job && job.title) { collected.push(job); hits++; }
      }
      await sleep(110);
    }
    console.log(`[${SOURCE}] ${place.wo}: ${hits} neue Treffer`);
  }

  let added = 0, merged = 0;
  for (const job of collected) {
    const hit = payload.jobs.find(x => same(x, job));
    if (hit) {
      merged++;
      hit.sources = Array.isArray(hit.sources) ? hit.sources : [];
      if (!hit.sources.some(s => s.url === job.url)) hit.sources.push({ name: SOURCE, url: job.url });
      if (!Number.isFinite(hit.lat) && Number.isFinite(job.lat)) { hit.lat = job.lat; hit.lon = job.lon; }
      if (!hit.address && job.address) hit.address = job.address;
      continue;
    }
    payload.jobs.push(job);
    added++;
  }

  const entry = { name: SOURCE, count: added, status: 'ok' };
  const existing = payload.meta.sources.find(x => x.name === SOURCE);
  if (existing) Object.assign(existing, entry); else payload.meta.sources.push(entry);

  payload.meta.generatedAt = new Date().toISOString();
  payload.meta.total = payload.jobs.length;
  await fs.writeFile(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`${SOURCE}: ${added} neue, ${merged} zusammengeführt. Gesamt ${payload.jobs.length}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
