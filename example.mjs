// Runnable demo — no ffmpeg needed. Builds synthetic RGBA "frames" (four solid
// colors, each repeated with a little noise) and shows the detector recovering
// exactly four slides at the boundaries.
//
//   node example.mjs

import { extractSlideIndices } from './index.js';

const W = 160, H = 90;

function solidFrame(r, g, b, noise = 0) {
  const f = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < f.length; i += 4) {
    const n = noise ? (Math.floor(((i * 2654435761) % 512) / 512 * noise) - noise / 2) : 0;
    f[i] = r + n; f[i + 1] = g + n; f[i + 2] = b + n; f[i + 3] = 255;
  }
  return f;
}

// Four "slides", three noisy repeats each — 12 frames, 4 distinct.
const palette = [[20, 120, 80], [200, 40, 60], [40, 60, 200], [230, 200, 30]];
const frames = [];
for (const [r, g, b] of palette) {
  for (let k = 0; k < 3; k++) frames.push(solidFrame(r, g, b, 12));
}

const kept = extractSlideIndices(frames, W, H);
console.log('frames:', frames.length);
console.log('slides at sample #:', kept);          // → [0, 3, 6, 9]
console.log(kept.length === 4 ? 'OK — 4 slides recovered' : 'unexpected');
