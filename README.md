# AstroVR — My First Moon Mission

**NASA Space Apps Challenge 2026 · Ganja, Azerbaijan · Challenge: _Build a Junior Astronaut Mission Trainer_ · Team UNECom**

A two-player Moon mission trainer for kids aged 7–12.

- 🧑‍🚀 **Astronaut:** a phone in a cheap VR box. The cadet stands on real NASA LOLA terrain of **Nobile Rim 1**, an Artemis III candidate region at the lunar south pole.
- 🖥️ **Mission Control:** a laptop that runs the outpost: ⚡ power, 🫁 oxygen and ☢️ radiation shielding, plus a 🌱 greenhouse.
- ☀️ **The crisis is real:** the Sun drops behind a ridge (south-pole lighting), then the **11 May 2024 solar storm recorded in NASA DONKI** arrives. The real ~60 min flare-to-proton warning becomes 60 s in game (1 real minute ≈ 1 EVA hour).
- Every choice has a real cost:
  - storm shelter ≈ 4× less dose (Artemis I);
  - crater shadow −40% dose (LRO/CRaTER modelling);
  - raising a 10 m solar mast (NASA VSAT);
  - switching the greenhouse off stresses the plants (OSDR OSD-476).

> Training prototype for education. It does not replace professional astronaut training.

## Run
```bash
npm install
npm run dev          # http://localhost:5173/control.html  (open a.html?room=CODE&transport=local in a 2nd tab to test without a backend)
npm run dev:https    # HTTPS on the LAN so phones can use the gyroscope (iPhone requires HTTPS)
npm test             # simulation unit tests
npm run build
npm run check        # typecheck + tests + build: RUN THIS BEFORE EVERY PUSH
npm run fetch-data   # re-download the real NASA data (needs .env with NASA_API_KEY)
npm run check-realtime  # Supabase two-client broadcast test
```
Copy `.env.example` → `.env.local` and set the Supabase URL + anon key (Realtime Broadcast, no tables) and a NASA API key.

## Architecture
- **Mission Control is authoritative.** `src/sim` runs only on the laptop. The phone sends pose + actions and renders the state.
- Single Vite multi-page app: `/control.html` (React) and `/a.html` (three.js stereo, no WebXR, so it works on Android and iPhone).

| Folder | Owner | What |
|---|---|---|
| `src/shared` | all (frozen contract) | types, protocol, scenario, i18n, transport (Supabase / local) |
| `src/sim` | P4 | pure-TS model + constants with sources + tests |
| `src/scene` | P1 | terrain, sky, Sun, Earth, lighting |
| `src/astronaut` | P2 | stereo, gyroscope, gaze, lope, wrist panel |
| `src/control` | P3 | Mission Control console |
| `src/audio` | P5 | suit sounds, radio, voice lines (AI TTS, disclosed) |

## NASA data & resources
- DONKI (FLR + SEP records)
- LRO LOLA south-pole DEM (PGDA)
- SVS CGI Moon Kit
- SVS Deep Star Maps
- OSDR OSD-476
- RadLab
- Artemis I radiation measurements (Nature 2024)
- NASA VSAT
- Space Agency Partner: CSA food-production toolkit

## Use of AI
AI tools (Claude Code, Codex) assisted with research and code. Voice lines are AI text-to-speech and are labelled as such. AI-generated images carry a visible watermark. The mission concept and design decisions are the team's own.
