// Moon Base Radio smoke test: mint a real token (same code as /api/live-token),
// open the Constrained Live socket, ask one question per voice/language, save WAVs.
//
//   node --env-file=.env scripts/live-smoke.mjs                       # default voices
//   node --env-file=.env scripts/live-smoke.mjs Achird,Sulafat az      # pick voices / langs
//   GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview node --env-file=.env scripts/live-smoke.mjs Charon az
//
// Output: ../raw/voice-samples/<model>-<voice>-<lang>.wav (listen and pick by ear)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintRadioToken } from '../api/live-token.ts';

const WS =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../raw/voice-samples');
mkdirSync(outDir, { recursive: true });

const voices = (process.argv[2] || 'Achird,Sulafat,Umbriel,Sadachbia,Puck,Kore').split(',');
const langs = (process.argv[3] || 'az,en').split(',');
const QUESTIONS = {
  az: 'Salam Nova! Ayda nə yeyirsiniz? Bir də, niyə Ayda belə hoppanırsınız?',
  en: 'Hi Nova! What do you eat on the Moon? And why do you bounce so much?',
};

function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function one(voice, lang) {
  const env = { ...process.env, GEMINI_LIVE_VOICE: voice, GEMINI_LIVE_VOICE_AZ: '', GEMINI_LIVE_VOICE_EN: '' };
  const t0 = Date.now();
  const mint = await mintRadioToken({ lang, key: process.env.SMOKE_KEY || 1, name: 'Aysel' }, env);
  if (mint.status !== 200) return { voice, lang, error: mint.body.error };
  const { token, model } = mint.body;
  const tMint = Date.now() - t0;

  return await new Promise((done) => {
    const ws = new WebSocket(`${WS}?access_token=${encodeURIComponent(token)}`);
    const chunks = [];
    let text = '';
    let tAsk = 0;
    let tFirst = 0;
    const timer = setTimeout(() => { ws.close(); done({ voice, lang, model, error: 'timeout', text }); }, 40000);
    ws.onopen = () =>
      ws.send(JSON.stringify({ setup: { realtimeInputConfig: { automaticActivityDetection: { disabled: true } }, sessionResumption: {} } }));
    ws.onmessage = async (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(await ev.data.arrayBuffer()).toString('utf8');
      const msg = JSON.parse(raw);
      if (msg.setupComplete) {
        tAsk = Date.now();
        ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: QUESTIONS[lang] }] }], turnComplete: true } }));
        return;
      }
      const sc = msg.serverContent;
      if (!sc) return;
      for (const p of sc.modelTurn?.parts ?? []) {
        if (p.inlineData?.data) {
          if (!tFirst) tFirst = Date.now() - tAsk;
          chunks.push(Buffer.from(p.inlineData.data, 'base64'));
        }
      }
      if (sc.outputTranscription?.text) text += sc.outputTranscription.text;
      if (sc.turnComplete) {
        clearTimeout(timer);
        ws.close();
        const pcm = Buffer.concat(chunks);
        const file = resolve(outDir, `${model.replace(/[^\w.-]/g, '_')}-${voice}-${lang}.wav`);
        writeFileSync(file, wav(pcm));
        done({ voice, lang, model, tMint, firstAudioMs: tFirst, seconds: +(pcm.length / 48000).toFixed(1), file, text: text.trim() });
      }
    };
    ws.onclose = (e) => { clearTimeout(timer); done({ voice, lang, model, error: `closed ${e.code} ${e.reason}`, text }); };
  });
}

for (const lang of langs) {
  for (const voice of voices) {
    const r = await one(voice.trim(), lang.trim());
    console.log(JSON.stringify(r));
  }
}
