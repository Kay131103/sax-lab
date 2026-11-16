# 🎷 Sax Lab

**An ML tutor for the instrument I practice at night.**

Real-time pitch detection written from scratch (autocorrelation — no libraries, no
models to download), grading long tones, intonation drift and stability — all in your
browser, all on-device, all free. No server, no uploads, no keys.

## What it does
- **Live pitch track** — a scrolling stave that follows your note, lane by lane
- **Intonation readout** — cents deviation from the nearest note, with a needle
- **Long-tone grading** — hold a note and get graded automatically:
  - 🥇 **gold**: 5s+ hold, drift < 10¢, stability σ < 20¢
  - 🥈 **silver**: 3s+ · 🥉 **bronze**: 2s+ · otherwise: *"try again tomorrow"*
- Grading measures **breath support** (duration), **embouchure consistency** (median
  drift) and **air control** (σ of cents deviation)
- **Sargam (sarali varisai, Carnatic)** — set your adharashadja (Sa), pick a melakarta
  (Mayamalavagowla, Shankarabharanam, Kharaharapriya, Harikambhoji, Natabhairavi, Todi
  — or all 12 swara sthanas), and the tutor walks you through three octaves of swaras,
  grading every note with its sthayi (madhya/taara) marked.
- **No sax?** Hit *play test tone* — a synthesized reed-like tone with vibrato and slow
  drift runs through the same detector. Whistle or hum works too.

## How the detection works
The mic's PCM buffer is correlated against itself at every lag (`ACF2+` method);
the first strong peak after the direct signal is the fundamental's period, and
parabolic interpolation sharpens it to sub-sample precision. ~60 detections/second,
entirely in this tab.

## Files
| File | What it is |
|---|---|
| `src/pitch.js` | autocorrelation pitch detector (~60 lines) |
| `src/notes.js` | frequency → note/cents math (A4 = 440) |
| `src/main.js` | audio graph, demo tone, stave renderer, grading |

## Run / build / deploy
```bash
npm install
npm run dev      # → http://localhost:5173 (mic needs localhost or HTTPS)
npm run build    # → dist/
```
GitHub Actions deploys to Cloudflare Pages on every push to `main`.
Live: **https://sax.krithiuk.space**
