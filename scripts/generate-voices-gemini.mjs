#!/usr/bin/env node
/**
 * Generates the AI voice lines (EN + AZ) with Google Gemini text-to-speech (gemini-3.8-flash-tts, which supports
 * North Azerbaijani natively) → public/audio/{lang}/{id}.mp3, loudness-normalised to -16 LUFS, leading/trailing
 * silence trimmed. Registers ids in src/audio/available.json. Voice lines are AI-generated (disclosed).
 *   node --env-file=.env scripts/generate-voices-gemini.mjs                 all groups, both languages
 *   node --env-file=.env scripts/generate-voices-gemini.mjs az story        filter by language and/or group
 *   node --env-file=.env scripts/generate-voices-gemini.mjs story1 countdown   or by line id
 * Keys: GEMINI_API_KEY, GEMINI_API_KEY2..9 — used in turn; a key that hits its quota is skipped.
 * Needs ffmpeg (FFMPEG=path or on PATH).
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLIGHT, RADIO, STORY, SUIT } from '../src/audio/lines.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
const KEYS = ['', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => process.env[`GEMINI_API_KEY${n}`]).filter(Boolean);
if (!KEYS.length) {
  console.error('Missing GEMINI_API_KEY in .env');
  process.exit(1);
}

const AZ = 'Speak in Azerbaijani (Azərbaycan dili) with a natural, native Baku pronunciation.';
const EN = 'Speak in clear, natural English.';
/** voice + delivery per group (style goes to speech_metadata.style; the transcript stays verbatim) */
const VOICES = {
  story: {
    voice: 'algenib',
    style:
      'Epic cinematic movie-trailer narrator. Deep, powerful and full of awe. Measured pace with natural dramatic pauses between phrases, building wonder and excitement.',
  },
  flight: {
    voice: 'alnilam',
    style: 'Launch control commentator talking to a young astronaut inside the rocket. Confident, energetic and clear, like a live launch broadcast. Exciting on "Liftoff".',
  },
  radio: {
    voice: 'charon',
    style: 'Calm, warm and confident Mission Control CAPCOM speaking over the radio to a child astronaut on the Moon. Clear and reassuring, natural conversational pace.',
  },
  suit: {
    voice: 'sulafat',
    style: 'Friendly, warm spacesuit assistant talking to a nine-year-old astronaut. Clear, encouraging, natural pace, a smile in the voice.',
  },
};

const args = process.argv.slice(2);
const langs = args.filter((a) => a === 'en' || a === 'az');
const groups = args.filter((a) => a in VOICES);
const ids = args.filter((a) => !langs.includes(a) && !groups.includes(a));
const LANGS = langs.length ? langs : ['en', 'az'];

let keyIdx = 0;
const dead = new Set();
async function tts(text, lang, kind) {
  const v = VOICES[kind];
  for (let attempt = 0; attempt < 12; attempt++) {
    const live = KEYS.map((_, i) => i).filter((i) => !dead.has(i));
    if (!live.length) throw new Error('all keys exhausted');
    const k = live[keyIdx++ % live.length];
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': KEYS[k], 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: `${v.style} ${lang === 'az' ? AZ : EN}` }] }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: v.voice }] },
      }),
    });
    if (res.status === 429 || res.status === 403) {
      const body = await res.text();
      if (/per.?day|daily|exhausted|billing|quota/i.test(body) && !/per.?minute/i.test(body)) dead.add(k);
      console.warn(`  key ${k + 1}: ${res.status}${dead.has(k) ? ' (daily quota, skipping key)' : ' (rate limit, retry)'}`);
      await new Promise((r) => setTimeout(r, dead.has(k) ? 200 : 4000));
      continue;
    }
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    const j = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(j).slice(0, 200)}`);
    const audio = (j.steps ?? [])
      .filter((s) => s.type === 'model_output')
      .flatMap((s) => s.content ?? [])
      .filter((c) => c.type === 'audio')
      .pop();
    if (!audio?.data) throw new Error('no audio in response');
    return Buffer.from(audio.data, 'base64');
  }
  throw new Error('too many retries');
}

/** WAV → trimmed, -16 LUFS mp3 */
function encode(wav, out) {
  const tmp = join(tmpdir(), `astrovr-tts-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);
  return writeFile(tmp, wav).then(() =>
    execFileSync(FFMPEG, [
      '-v', 'error', '-y', '-i', tmp,
      '-af',
      'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.12,areverse,loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', out,
    ]),
  );
}

const availPath = join(ROOT, 'src/audio/available.json');
const available = JSON.parse(await readFile(availPath, 'utf8'));
const jobs = [
  ...Object.entries(RADIO).map(([id, t]) => ({ id, t, kind: 'radio' })),
  ...Object.entries(SUIT).map(([id, t]) => ({ id, t, kind: 'suit' })),
  ...Object.entries(STORY).map(([id, t]) => ({ id, t, kind: 'story' })),
  ...Object.entries(FLIGHT).map(([id, t]) => ({ id, t, kind: 'flight' })),
].filter((j) => (!groups.length || groups.includes(j.kind)) && (!ids.length || ids.includes(j.id)));

const work = LANGS.flatMap((lang) => jobs.map((j) => ({ ...j, lang })));
for (const lang of LANGS) await mkdir(join(ROOT, 'public/audio', lang), { recursive: true });
const done = { en: new Set(available.en ?? []), az: new Set(available.az ?? []) };
let failed = 0;
const PAR = Math.min(KEYS.length, 4);
let next = 0;
await Promise.all(
  Array.from({ length: PAR }, async () => {
    while (next < work.length) {
      const j = work[next++];
      try {
        const wav = await tts(j.t[j.lang], j.lang, j.kind);
        await encode(wav, join(ROOT, 'public/audio', j.lang, `${j.id}.mp3`));
        done[j.lang].add(j.id);
        console.log('✓', j.lang, j.kind, j.id);
      } catch (e) {
        failed++;
        console.error('✗', j.lang, j.id, e.message);
      }
    }
  }),
);
for (const lang of ['en', 'az']) available[lang] = [...done[lang]].sort();
await writeFile(availPath, JSON.stringify(available, null, 2) + '\n');
console.log(`available.json updated · ${work.length - failed}/${work.length} ok`);
if (failed) process.exitCode = 1;
