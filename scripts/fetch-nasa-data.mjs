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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// run as `node --env-file=.env scripts/fetch-nasa-data.mjs` to use your own key (DEMO_KEY ≈ 10 requests/hour)
const KEY = process.env.NASA_API_KEY || process.env.VITE_NASA_API_KEY || 'DEMO_KEY';

/**
 * Mission site: the sunniest 60 m pixel of Artemis III candidate region "Nobile Rim 1" (PGDA Site06,
 * Zenodo 17954508 README bounding box). Found from the LOLA average-illumination map (83 % sunlit).
 */
export const SITE = { name: 'Nobile Rim 1 (sunniest point)', lat: -85.3003, lon: 37.0989 };
const MOON_R_KM = 1737.4;
const ONLY = process.argv.slice(2); // optional: run only some steps, e.g. `node scripts/fetch-nasa-data.mjs terrain`

/** South polar stereographic (PGDA/LOLA): lat/lon → projected metres. */
function polarXY(latDeg, lonDeg) {
  const rho = 2 * MOON_R_KM * 1000 * Math.tan(((latDeg + 90) * Math.PI) / 360);
  const lon = (lonDeg * Math.PI) / 180;
  return { x: rho * Math.sin(lon), y: rho * Math.cos(lon) };
}

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
  if (ONLY.length && !ONLY.some((k) => name.toLowerCase().includes(k.toLowerCase()))) return;
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

// 7) LRO LOLA 5 m DEM (NASA PGDA, Site06 = Nobile Rim 1): real terrain around the site, resampled to a local
//    east/north grid (scene axes) with HTTP range requests (only the needed rows of the 64 MB GeoTIFF).
await step('LOLA terrain', async () => {
  const url = 'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site06/Site06_final_adj_5mpp_surf.tif';
  const X0 = 74000, Y0 = 120000, PX = 5, W = 4000, DATA_OFF = 25603, ROW_BYTES = W * 4; // from the GeoTIFF header
  const HALF = 240; // metres: 480 m × 480 m scene
  const STEP = 4; // metres between output samples
  const c = polarXY(SITE.lat, SITE.lon);
  const lon = (SITE.lon * Math.PI) / 180;
  const pad = Math.ceil((HALF * Math.SQRT2) / PX) + 3;
  const row0 = Math.round((Y0 - c.y) / PX) - pad, row1 = Math.round((Y0 - c.y) / PX) + pad;
  const res = await fetch(url, { headers: { Range: `bytes=${DATA_OFF + row0 * ROW_BYTES}-${DATA_OFF + (row1 + 1) * ROW_BYTES - 1}` } });
  if (res.status !== 206) throw new Error(`range request failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const px = (r, cc) => buf.readFloatLE((r - row0) * ROW_BYTES + cc * 4);
  const sample = (x, y) => {
    // bilinear in pixel space; (x, y) projected metres
    const fc = (x - X0) / PX - 0.5, fr = (Y0 - y) / PX - 0.5;
    const c0 = Math.floor(fc), r0 = Math.floor(fr), tc = fc - c0, tr = fr - r0;
    const a = px(r0, c0), b = px(r0, c0 + 1), d = px(r0 + 1, c0), e = px(r0 + 1, c0 + 1);
    return (a * (1 - tc) + b * tc) * (1 - tr) + (d * (1 - tc) + e * tc) * tr;
  };
  // local frame at the site: north = radially away from the pole, east = increasing longitude
  const toProj = (east, north) => ({
    x: c.x + east * Math.cos(lon) + north * Math.sin(lon),
    y: c.y - east * Math.sin(lon) + north * Math.cos(lon),
  });
  const centre = sample(c.x, c.y);
  const n = (2 * HALF) / STEP + 1;
  const heights = [];
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    // row i: scene z from -HALF (north) to +HALF (south)
    const z = -HALF + i * STEP;
    for (let j = 0; j < n; j++) {
      const x = -HALF + j * STEP;
      const p = toProj(x, -z);
      const h = sample(p.x, p.y) - centre;
      min = Math.min(min, h);
      max = Math.max(max, h);
      heights.push(Math.round(h * 100) / 100);
    }
  }
  await save('src/data/terrain-nobile.json', {
    source: 'NASA LRO LOLA 5 m/px DEM, PGDA product 78 (Barker et al.), Site06 = Nobile Rim 1',
    url,
    fetchedAt: now,
    site: SITE,
    centreElevationM: Math.round(centre * 10) / 10,
    sizeM: 2 * HALF,
    stepM: STEP,
    n,
    layout: 'row-major; rows from north (z=-sizeM/2) to south; columns from west to east; metres relative to the centre',
    minM: Math.round(min * 10) / 10,
    maxM: Math.round(max * 10) / 10,
    heights,
  });
  manifest.push({
    id: 'lola-terrain',
    name: `LRO LOLA 5 m terrain, ${2 * HALF} m × ${2 * HALF} m around the site (centre elevation ${Math.round(centre)} m)`,
    org: 'NASA GSFC PGDA',
    url: 'https://pgda.gsfc.nasa.gov/products/78',
    usedFor: 'The ground you walk on is real Moon terrain measured by laser from orbit',
  });
});

// 8) LOLA average illumination + Earth visibility (Mazarico et al., 60 m/px, hourly over 18.6 years) at the site
await step('LOLA illumination', async () => {
  const NS = 5058, S0 = 2528.5, SC = 60;
  const c = polarXY(SITE.lat, SITE.lon);
  const sampleNo = Math.floor(c.x / SC + S0 + 1), lineNo = Math.floor(S0 + 1 - c.y / SC);
  const at = async (url) => {
    const off = ((lineNo - 1) * NS + (sampleNo - 1)) * 2;
    const r = await fetch(url, { headers: { Range: `bytes=${off}-${off + 1}` } });
    const b = Buffer.from(await r.arrayBuffer());
    return Math.round(b.readInt16LE(0) * 0.00004 * 1000) / 10; // percent
  };
  const base = 'http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/AVGVISIB_85S_060M_201608';
  const sunPct = await at(`${base}.IMG`);
  const earthPct = await at(`${base}_EARTH.IMG`);
  await save('src/data/illumination-site.json', {
    source: 'LOLA-derived average visibility maps (Mazarico et al. 2011), NASA PGDA / MIT imbrium',
    urls: [`${base}.IMG`, `${base}_EARTH.IMG`],
    fetchedAt: now,
    site: SITE,
    sunlitPercent: sunPct,
    earthVisiblePercent: earthPct,
  });
  manifest.push({
    id: 'illumination',
    name: `Average sunlight ${sunPct}% and Earth visibility ${earthPct}% at the site`,
    org: 'NASA GSFC PGDA (LRO LOLA)',
    url: 'https://pgda.gsfc.nasa.gov/products/69',
    usedFor: 'Why this site was chosen: power from the Sun and radio contact with Earth',
  });
});

// 9) ISS radiation baseline: TEPC dosimeter (NASA SPDF CDAWeb HAPI), one full day
await step('ISS TEPC dose', async () => {
  const url =
    'https://cdaweb.gsfc.nasa.gov/hapi/data?id=ISS_DOSANL_TEPC&time.min=2018-03-01T00:00:00Z&time.max=2018-03-02T00:00:00Z&parameters=DOSE,DOSE_EQ60&format=csv';
  const rows = (await get(url, 'text')).trim().split('\n').filter((l) => l.startsWith('20')).map((l) => l.split(',').map((v, i) => (i ? Number(v) : v)));
  const ok = rows.filter((r) => r[1] >= 0);
  const uGyPerDay = (ok.reduce((s, r) => s + r[1], 0) / ok.length) * 1440;
  const uSvPerDay = (ok.reduce((s, r) => s + r[2], 0) / ok.length) * 1440;
  await save('src/data/iss-dose.json', {
    source: 'ISS TEPC dose analyzer, NASA SPDF CDAWeb (ISS_DOSANL_TEPC)',
    url,
    fetchedAt: now,
    day: '2018-03-01',
    minutes: ok.length,
    absorbedMGyPerDay: Math.round(uGyPerDay) / 1000,
    doseEquivalentMSvPerDay: Math.round(uSvPerDay) / 1000,
  });
  manifest.push({
    id: 'iss-tepc',
    name: `ISS daily dose (TEPC, 2018-03-01): ${Math.round(uGyPerDay)} µGy/day`,
    org: 'NASA JSC SRAG · NASA SPDF CDAWeb',
    url: 'https://cdaweb.gsfc.nasa.gov/',
    usedFor: '"Your EVA dose = X days on the Space Station" comparison',
  });
});

// 10) NASA SVS imagery: Deep Star Maps (real star catalogue sky) and the LRO south-pole colour map (Mission Control map)
await step('SVS images', async () => {
  const items = [
    { url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_4k_print.jpg', file: 'public/textures/starmap.jpg', name: 'Deep Star Maps 2020 (Hipparcos-2, Tycho-2, Gaia DR2)', svs: 'https://svs.gsfc.nasa.gov/4851', usedFor: 'Real star positions in the black lunar sky' },
    { url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_1k.jpg', file: 'public/images/moon-poles.jpg', name: 'CGI Moon Kit: LRO colour map of the poles', svs: 'https://svs.gsfc.nasa.gov/4720', usedFor: 'Mission Control map of the lunar south pole' },
  ];
  for (const it of items) {
    await save(it.file, await get(it.url, 'buffer'));
    manifest.push({ id: it.file, name: it.name, org: 'NASA Scientific Visualization Studio', url: it.svs, usedFor: it.usedFor });
  }
});

// Facts read by the research agent from NASA documents (not fetched as data files)
manifest.push(
  { id: 'diviner', name: 'LRO Diviner surface temperature at the site: average ~130 K, maximum ~236–263 K; permanently shadowed craters ~25–40 K', org: 'NASA LRO Diviner (PDS Polar Resource Product)', url: 'https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/', usedFor: 'Suit temperature: sunlit vs shadow' },
  { id: 'bvad', name: 'Crew oxygen use 0.895 kg per person per day (NASA BVAD Rev 2, 2022, Table 3-31)', org: 'NASA', url: 'https://ntrs.nasa.gov/citations/20210024855', usedFor: 'Oxygen model' },
  { id: 'lsc-15415', name: 'Apollo 15 sample 15415 "Genesis Rock": ferroan anorthosite, 98% plagioclase, ~4 billion years', org: 'NASA JSC Lunar Sample Compendium', url: 'https://curator.jsc.nasa.gov/lunar/lsc/15415.pdf', usedFor: 'Science card after collecting a sample' },
  { id: 'artemis1-radiation', name: 'Artemis I radiation measurements: storm shelter ≈ 4× lower dose (Nature 2024)', org: 'NASA / DLR', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11446838/', usedFor: 'Shelter protection factor' },
  { id: 'osd-476', name: 'Plants grown in Apollo lunar regolith show stress responses (OSD-476)', org: 'NASA OSDR', url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-476', usedFor: 'Greenhouse stress mechanic' },
);

// merge with the existing manifest so partial or partly failed runs keep the other entries
let previous = [];
try {
  previous = JSON.parse(await readFile(join(ROOT, 'src/data/manifest.json'), 'utf8')).datasets ?? [];
} catch {
  /* first run */
}
const ids = new Set(manifest.map((m) => m.id));
const merged = [...previous.filter((m) => !ids.has(m.id)), ...manifest];
await save('src/data/manifest.json', { generatedAt: now, site: SITE, datasets: merged });
console.log(`\nmanifest: ${merged.length} datasets → src/data/manifest.json`);
