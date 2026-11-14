#!/usr/bin/env node
/**
 * Generates the AI voice lines (EN + AZ) with OpenAI text-to-speech → public/audio/{lang}/{id}.mp3
 * and registers them in src/audio/available.json. Voice lines are AI-generated (disclosed in README / submission).
 *   node --env-file=.env scripts/generate-voices.mjs            (needs OPENAI_API_KEY in .env)
 *   node --env-file=.env scripts/generate-voices.mjs az          (one language)
 * Lines come from src/audio/lines.ts (Node strips the TypeScript types).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLIGHT, RADIO, STORY, SUIT } from '../src/audio/lines.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}
const MODEL = process.env.TTS_MODEL || 'gpt-4o-mini-tts';
const langs = process.argv.slice(2).filter((a) => a === 'en' || a === 'az');
// optional filter: `node --env-file=.env scripts/generate-voices.mjs story flight` → only those groups
const groups = process.argv.slice(2).filter((a) => ['radio', 'suit', 'story', 'flight'].includes(a));
const LANGS = langs.length ? langs : ['en', 'az'];

const VOICES = {
  radio: {
    voice: 'onyx',
    instructions:
      'You are NASA Mission Control (CAPCOM) talking to a child astronaut on the Moon over the radio. Calm, warm, clear, confident, short pauses. Not dramatic.',
  },
  story: {
    voice: 'onyx',
    instructions:
      'You are the narrator of an epic space movie trailer. Deep, slow, powerful and full of wonder. Leave dramatic pauses at the "…" marks. Build tension, then hope. Never rush.',
  },
  flight: {
    voice: 'onyx',
    instructions: 'You are launch control talking to a young astronaut inside the rocket. Confident and exciting, clear numbers, a little faster on "Liftoff!".',
  },
  suit: {
    voice: 'nova',
    instructions:
      'You are the friendly spacesuit computer of a child astronaut (age 7-12). Gentle, clear, encouraging, a little slower than normal.',
  },
};

async function tts(text, lang, kind) {
  const v = VOICES[kind];
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      voice: v.voice,
      input: text,
      instructions: `${v.instructions} Speak in ${lang === 'az' ? 'Azerbaijani (Azərbaycan dili), natural Baku pronunciation' : 'English'}.`,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

const availPath = join(ROOT, 'src/audio/available.json');
const available = JSON.parse(await readFile(availPath, 'utf8'));
const jobs = [
  ...Object.entries(RADIO).map(([id, t]) => ({ id, t, kind: 'radio' })),
  ...Object.entries(SUIT).map(([id, t]) => ({ id, t, kind: 'suit' })),
  ...Object.entries(STORY).map(([id, t]) => ({ id, t, kind: 'story' })),
  ...Object.entries(FLIGHT).map(([id, t]) => ({ id, t, kind: 'flight' })),
].filter((j) => !groups.length || groups.includes(j.kind));
for (const lang of LANGS) {
  await mkdir(join(ROOT, 'public/audio', lang), { recursive: true });
  const ok = new Set(available[lang] ?? []);
  for (const j of jobs) {
    try {
      const mp3 = await tts(j.t[lang], lang, j.kind);
      await writeFile(join(ROOT, 'public/audio', lang, `${j.id}.mp3`), mp3);
      ok.add(j.id);
      console.log('✓', lang, j.id, `${Math.round(mp3.length / 1024)} KB`);
    } catch (e) {
      console.error('✗', lang, j.id, e.message);
    }
  }
  available[lang] = [...ok].sort();
}
await writeFile(availPath, JSON.stringify(available, null, 2) + '\n');
console.log('available.json updated');
