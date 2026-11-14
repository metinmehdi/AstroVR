#!/usr/bin/env node
/**
 * Builds the rocket-flight "window film" from REAL NASA footage (public domain, NASA Image and Video Library):
 *   - Artemis I SLS rocket-camera footage (booster separation)
 *   - Artemis I mission highlights: Orion's first views of Earth, the Moon, the lunar surface, Earthrise
 *   - Artemis II launch-pad microphone (the real SLS roar)
 * Crops remove on-screen captions, timestamps and every NASA insignia (Space Apps rule: no NASA logos).
 * Output (one file holds the full edit followed by the short pitch edit, so the phone preloads only one video):
 *   public/video/flight-film.mp4   1280×720 H.264, no audio
 *   public/audio/fx/launch-roar.mp3
 *   src/data/flight-film.json      offsets + segment list + provenance
 * Needs ffmpeg on PATH (or FFMPEG=path). Sources are cached in .cache/film/.
 *   node scripts/build-flight-film.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache/film');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
mkdirSync(CACHE, { recursive: true });
mkdirSync(join(ROOT, 'public/video'), { recursive: true });
mkdirSync(join(ROOT, 'public/audio/fx'), { recursive: true });

const SRC = {
  rocketcam: {
    nasaId: 'Artemis I - Rocket Camera Footage',
    title: 'Artemis I Rocket Camera Footage of Ascent (2022)',
    url: 'https://images-assets.nasa.gov/video/Artemis%20I%20-%20Rocket%20Camera%20Footage/Artemis%20I%20-%20Rocket%20Camera%20Footage~large.mp4',
    file: 'rocketcam.mp4',
  },
  highlights: {
    nasaId: "Highlights From the First 13 Days of NASA's Artemis I Moon Mission",
    title: "Highlights From the First 13 Days of NASA's Artemis I Moon Mission (2022)",
    url: "https://images-assets.nasa.gov/video/Highlights%20From%20the%20First%2013%20Days%20of%20NASA's%20Artemis%20I%20Moon%20Mission/Highlights%20From%20the%20First%2013%20Days%20of%20NASA's%20Artemis%20I%20Moon%20Mission~large.mp4",
    file: 'hl.mp4',
  },
  padmic: {
    nasaId: 'KSC-20260401-AU-LMM01-0001-Artemis_II_Live_Launch_Coverage_Pad_Camera_Site_4',
    title: 'Artemis II Live Launch Coverage - Pad Camera Site 4 (SLS liftoff sound, 1 Apr 2026)',
    url: 'https://images-assets.nasa.gov/audio/KSC-20260401-AU-LMM01-0001-Artemis_II_Live_Launch_Coverage_Pad_Camera_Site_4/KSC-20260401-AU-LMM01-0001-Artemis_II_Live_Launch_Coverage_Pad_Camera_Site_4~orig.wav',
    file: 'padmic.wav',
  },
};

for (const s of Object.values(SRC)) {
  const p = join(CACHE, s.file);
  if (existsSync(p)) continue;
  console.log('downloading', s.nasaId);
  execFileSync('curl', ['-s', '-L', '-o', p, s.url], { stdio: 'inherit' });
}

/**
 * Segments: [source, start, end, crop "w:h:x:y" | null, speed (1 = real time), what]
 * Crops were chosen frame by frame (contact sheets) to exclude captions (lower left), timestamps (top left)
 * and the NASA wordmark on Orion.
 */
const RC = '1742:980:178:100'; // below the camera timestamp
const FULL = [
  ['rocketcam', 5.0, 11.0, RC, 1, 'SLS solid rocket boosters separate (rocket camera, night launch)'],
  ['highlights', 25.0, 27.4, '930:523:990:0', 1, "Orion's first view of Earth (crescent)"],
  ['highlights', 28.0, 30.8, '930:523:990:557', 1, "Orion's first view of Earth"],
  ['highlights', 42.2, 44.0, '1060:596:860:484', 0.5, 'Approaching the Moon (Orion camera)'],
  ['highlights', 44.0, 46.0, null, 0.5, 'Lunar surface during the flyby (Orion camera)'],
  ['highlights', 46.0, 50.0, '930:523:990:400', 0.6, 'Earthrise seen from Orion'],
  ['highlights', 50.5, 55.5, '1497:842:423:0', 1, 'The Moon beyond Orion\'s solar array'],
];
const SHORT = [
  ['rocketcam', 5.0, 9.0, RC, 1, 'SLS solid rocket boosters separate'],
  ['highlights', 28.0, 31.0, '930:523:990:557', 1, "Orion's first view of Earth"],
  ['highlights', 44.0, 46.0, null, 1, 'Lunar surface during the flyby'],
  ['highlights', 46.0, 50.0, '930:523:990:400', 0.8, 'Earthrise seen from Orion'],
  ['highlights', 50.5, 52.5, '1497:842:423:0', 1, "The Moon beyond Orion's solar array"],
];

const parts = [];
let i = 0;
function cut([src, a, b, crop, speed]) {
  const out = join(CACHE, `seg-${String(i++).padStart(2, '0')}.mp4`);
  const dur = (b - a) / speed;
  const fade = 0.25;
  const vf = [
    crop ? `crop=${crop}` : null,
    'scale=1280:720:flags=lanczos',
    speed !== 1 ? `setpts=${(1 / speed).toFixed(4)}*PTS` : null,
    'fps=30',
    `fade=t=in:st=0:d=${fade}`,
    `fade=t=out:st=${(dur - fade).toFixed(3)}:d=${fade}`,
    'format=yuv420p',
  ]
    .filter(Boolean)
    .join(',');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-ss', String(a), '-t', String(b - a), '-i', join(CACHE, SRC[src].file), '-an', '-vf', vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-r', '30', '-t', dur.toFixed(3), out]);
  parts.push(out);
  return dur;
}

const layout = (segs) => {
  let t = 0;
  return segs.map((s) => {
    const d = cut(s);
    const seg = { source: s[0], from: s[1], to: s[2], speed: s[4], what: s[5], at: Math.round(t * 1000) / 1000, dur: Math.round(d * 1000) / 1000 };
    t += d;
    return seg;
  });
};
const full = layout(FULL);
const fullLen = full.reduce((a, s) => a + s.dur, 0);
const short = layout(SHORT);
const shortLen = short.reduce((a, s) => a + s.dur, 0);

const list = join(CACHE, 'concat.txt');
writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level', '4.0', '-b:v', '2800k', '-maxrate', '3500k', '-bufsize', '6000k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(ROOT, 'public/video/flight-film.mp4')]);
// the real SLS roar (33 s from ignition build-up to the rocket flying away)
execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', join(CACHE, SRC.padmic.file), '-ac', '2', '-ar', '44100', '-b:a', '160k', '-af', 'afade=t=out:st=30:d=2.9', join(ROOT, 'public/audio/fx/launch-roar.mp3')]);

const r3 = (n) => Math.round(n * 1000) / 1000;
writeFileSync(
  join(ROOT, 'src/data/flight-film.json'),
  JSON.stringify(
    {
      video: '/video/flight-film.mp4',
      roar: '/audio/fx/launch-roar.mp3',
      full: { offset: 0, length: r3(fullLen), segments: full },
      short: { offset: r3(fullLen), length: r3(shortLen), segments: short },
      sources: Object.values(SRC).map(({ nasaId, title, url }) => ({ nasaId, title, url })),
      note: 'Real NASA footage (public domain). Captions, timestamps and NASA insignia cropped out.',
    },
    null,
    1,
  ),
);
console.log(`full ${fullLen.toFixed(2)} s, short ${shortLen.toFixed(2)} s → public/video/flight-film.mp4`);
