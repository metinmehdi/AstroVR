#!/usr/bin/env node
/**
 * Downloads REAL NASA data into the repo so the game runs offline and every number is traceable.
 *   node scripts/fetch-nasa-data.mjs            (uses NASA_API_KEY env var or DEMO_KEY)
 * Output:
 *   src/data/*.json      — data the game imports (with provenance)
 *   src/data/manifest.json — list of every dataset, source URL, fetch time, where it is used
 *   public/textures/earth-epic.jpg, public/images/*.jpg — real NASA imagery
 * No third-party packages (Node 18+ fetch).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'src', 'data');
const KEY = process.env.NASA_API_KEY || 'DEMO_KEY';

/** Mission site (Artemis III candidate region Nobile Rim 1). TODO: confirm exact coordinates from NASA. */
export const SITE = { name: 'Nobile Rim 1', lat: -85.4, lon: 37.0 };

const manifest = [];
const now = new Date().toISOString();

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: { 'User-Agent': 'AstroVR-hackathon-script' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return as === 'json' ? res.json() : as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer());
}

async function save(rel, obj) {
  const p = join(ROOT, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj, null, 1));
  return rel;
}

async function step(name, fn) {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    console.error('✗', name, '—', e.message);
  }
}

const redact = (u) => u.replace(KEY, 'API_KEY');

// 1) DONKI: the real storm of 11 May 2024 (flares + SEP + CME), NASA CCMC via api.nasa.gov
await step('DONKI May 2024', async () => {
  const range = 'startDate=2024-05-08&endDate=2024-05-14';
  const out = { source: 'NASA CCMC DONKI (api.nasa.gov)', fetchedAt: now };
  for (const kind of ['FLR', 'SEP', 'CME']) {
    const url = `https://api.nasa.gov/DONKI/${kind}?${range}&api_key=${KEY}`;
    try {
      out[kind] = await get(url);
      out[`${kind}_url`] = redact(url);
    } catch (e) {
      out[kind] = null;
      out[`${kind}_error`] = e.message.replace(KEY, 'API_KEY');
    }
  }
  await save('src/data/donki-2024-05.json', out);
  manifest.push({
    id: 'donki-2024-05',
    name: 'DONKI solar flares, SEP and CME records, 8–14 May 2024',
    org: 'NASA CCMC',
    url: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/',
    usedFor: 'Storm warning timing (flare 2024-05-11T01:10 → SEP), "this storm was real" card',
  });
});

// 2) SOHO EPHIN proton intensities (NASA SPDF CDAWeb HAPI) — the real shape of the storm
await step('SOHO EPHIN protons', async () => {
  const url =
    'https://cdaweb.gsfc.nasa.gov/hapi/data?id=SOHO_COSTEP-EPHIN_L3I-1HR&parameters=P_int' +
    '&time.min=2024-05-10T00:00Z&time.max=2024-05-14T00:00Z&format=csv';
  const csv = await get(url, 'text');
  const rows = csv
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('20'))
    .map((l) => {
      const [t, ...v] = l.split(',');
      return [t, ...v.map(Number)];
    });
  await save('src/data/ephin-2024-05.json', {
    source: 'SOHO COSTEP-EPHIN L3I 1-hour, NASA SPDF CDAWeb (HAPI)',
    url,
    fetchedAt: now,
    units: '(cm^2 s sr MeV)^-1',
    channels: ['4.3-7.8 MeV', '7.8-25 MeV', '25-40.9 MeV', '40.9-53 MeV'],
    rows,
  });
  manifest.push({
    id: 'ephin-2024-05',
    name: 'SOHO EPHIN proton intensity (hourly), 10–14 May 2024',
    org: 'ESA/NASA SOHO · NASA SPDF CDAWeb',
    url: 'https://cdaweb.gsfc.nasa.gov/',
    usedFor: 'Radiation dose rate during the storm (real measured proton intensity curve)',
  });
});

// 3) JPL Horizons: real Sun and Earth position (azimuth/elevation) seen from the site
async function horizons(command, start, stop, stepSize) {
  const q = new URLSearchParams({
    format: 'json',
    COMMAND: `'${command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${SITE.lon},${SITE.lat},0'`,
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: `'${stepSize}'`,
    QUANTITIES: "'4'",
  });
  const url = `https://ssd.jpl.nasa.gov/api/horizons.api?${q}`;
  const r = (await get(url)).result;
  const body = r.slice(r.indexOf('$$SOE') + 5, r.indexOf('$$EOE')).trim();
  const rows = body.split('\n').map((l) => {
    const m = l.trim().match(/^(\d{4}-\w{3}-\d{2} \d{2}:\d{2})\s+\S*\s+([-\d.]+)\s+([-\d.]+)/);
    return m ? [m[1], Number(m[2]), Number(m[3])] : null;
  });
  return { url, rows: rows.filter(Boolean) };
}

await step('JPL Horizons Sun/Earth at site', async () => {
  const start = now.slice(0, 10);
  const stopD = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
  const sun = await horizons('10', start, stopD, '2 h');
  const earth = await horizons('399', start, stopD, '2 h');
  await save('src/data/horizons-site.json', {
    source: 'NASA JPL Horizons System (observer ephemeris from a lunar surface site)',
    site: SITE,
    fetchedAt: now,
    columns: ['UTC', 'azimuthDeg', 'elevationDeg'],
    sun: sun.rows,
    earth: earth.rows,
    urls: [sun.url, earth.url],
  });
  manifest.push({
    id: 'horizons-site',
    name: `Sun and Earth azimuth/elevation from ${SITE.name}, next 30 days`,
    org: 'NASA JPL',
    url: 'https://ssd.jpl.nasa.gov/horizons/',
    usedFor: 'Real low-Sun lighting and Earth position in the sky; when the Sun drops behind the ridge',
  });
});

// 4) EPIC: a real photo of the whole Earth (DSCOVR) — used as the Earth in the lunar sky
await step('EPIC Earth image', async () => {
  const list = await get(`https://api.nasa.gov/EPIC/api/natural?api_key=${KEY}`);
  const img = list[0];
  const [y, m, d] = img.date.slice(0, 10).split('-');
  const jpg = `https://epic.gsfc.nasa.gov/archive/natural/${y}/${m}/${d}/jpg/${img.image}.jpg`;
  await save('public/textures/earth-epic.jpg', await get(jpg, 'buffer'));
  await save('src/data/epic.json', { source: 'NASA EPIC (DSCOVR)', date: img.date, image: img.image, url: jpg, fetchedAt: now });
  manifest.push({
    id: 'epic',
    name: `EPIC full-disk Earth photo, ${img.date}`,
    org: 'NASA GSFC / NOAA DSCOVR',
    url: 'https://epic.gsfc.nasa.gov/',
    usedFor: 'The Earth you see in the lunar sky is a real photo of Earth',
  });
});

// 5) NASA Image and Video Library: real Apollo sample photos for the science cards
await step('NASA Images: Apollo samples', async () => {
  const picks = [
    { id: 'S71-42955', file: 'public/images/genesis-rock.jpg', note: 'Apollo 15 sample 15415 "Genesis Rock" (anorthosite)' },
  ];
  const out = [];
  for (const p of picks) {
    const meta = await get(`https://images-api.nasa.gov/search?nasa_id=${p.id}`);
    const item = meta.collection.items[0];
    const assets = await get(item.href);
    const url = assets.find((u) => u.includes('~medium.jpg')) ?? assets.find((u) => u.endsWith('.jpg'));
    await save(p.file, await get(url.replace('http://', 'https://'), 'buffer'));
    out.push({ nasaId: p.id, title: item.data[0].title, description: item.data[0].description, url, file: p.file, note: p.note });
  }
  await save('src/data/samples.json', { source: 'NASA Image and Video Library', fetchedAt: now, items: out });
  manifest.push({
    id: 'nasa-images',
    name: 'Apollo lunar sample photographs',
    org: 'NASA',
    url: 'https://images.nasa.gov/',
    usedFor: 'Science card shown after collecting a sample',
  });
});

// 6) DONKI recent notifications — offline fallback for the live "Today's Sun" panel
await step('DONKI recent notifications', async () => {
  const end = now.slice(0, 10);
  const start = new Date(Date.now() - 14 * 86400e3).toISOString().slice(0, 10);
  const url = `https://api.nasa.gov/DONKI/notifications?startDate=${start}&endDate=${end}&type=all&api_key=${KEY}`;
  const list = await get(url);
  await save('src/data/donki-recent.json', {
    source: 'NASA CCMC DONKI notifications',
    fetchedAt: now,
    url: redact(url),
    items: list.map((n) => ({ type: n.messageType, time: n.messageIssueTime, url: n.messageURL, body: n.messageBody.slice(0, 1200) })),
  });
  manifest.push({
    id: 'donki-recent',
    name: 'DONKI space-weather notifications, last 14 days',
    org: 'NASA CCMC',
    url: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/',
    usedFor: '"Today\'s real Sun" panel (live API, this file is the offline cache)',
  });
});

await save('src/data/manifest.json', { generatedAt: now, site: SITE, datasets: manifest });
console.log(`\nmanifest: ${manifest.length} datasets → src/data/manifest.json`);
