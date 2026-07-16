// Builds the benchmark fixtures: videos rendered from known slide sequences,
// so the ground truth (every transition timestamp) is exact by construction —
// no manual labeling, fully reproducible, and legally clean to redistribute
// as scripts (the MIT slide images are fetched at run time, not committed).
//
// Two slide sources:
//   synthetic — 30 slides drawn by ffmpeg (deterministic, no external assets)
//   mit       — 46 real slides extracted from MIT OCW 6.0001 Lecture 1
//               (CC BY-NC-SA 4.0), fetched from video2any.com/decks/
//
// Three variants per source, same durations (so the same ground truth):
//   clean   — 960x540, hard cuts, crf 23
//   noisy   — heavy compression + down/upscale (codec noise & blur)
//   overlay — clean + animated "webcam" box bottom-right (presenter overlay)
//
// Usage: node bench/generate-fixtures.mjs   (needs ffmpeg on PATH)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BENCH = new URL('.', import.meta.url).pathname;
const FIXTURES = join(BENCH, 'fixtures');
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const MIT_BASE = 'https://video2any.com/decks/mit-what-is-computation';
const MIT_COUNT = 46;
const SYNTH_COUNT = 30;
const SEED = 60001;

// Deterministic PRNG (mulberry32) so durations — and therefore the ground
// truth — are identical on every machine.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

// ffmpeg colors want 0xRRGGBB, so convert from HSV here.
function hsvHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return '0x' + [f(5), f(3), f(1)].map(c => c.toString(16).padStart(2, '0')).join('');
}

function synthSlide(i, rng, out) {
  const hue = Math.floor(rng() * 360);
  const lineCount = 1 + Math.floor(rng() * 3);
  if (existsSync(out)) return;
  const bg = hsvHex(hue, 0.35, 0.25);
  const box = hsvHex((hue + 180) % 360, 0.5, 0.9);
  const bodyLines = ['first point about the topic', 'second point with more detail', 'a third supporting statement']
    .slice(0, lineCount)
    .map((l, k) => `- ${l} (${i}.${k + 1})`);
  const texts = [
    `drawtext=fontfile=${FONT}:text='Slide ${i} of the synthetic deck':fontsize=44:fontcolor=white:x=60:y=100`,
    ...bodyLines.map((l, k) => `drawtext=fontfile=${FONT}:text='${l}':fontsize=26:fontcolor=0xd8dcc8:x=60:y=${210 + k * 46}`)
  ];
  ff([
    '-f', 'lavfi', '-i', `color=c=${bg}:size=960x540:duration=0.1:rate=10`,
    '-vf', `drawbox=x=60:y=60:w=840:h=8:color=${box}:t=fill,${texts.join(',')}`,
    '-frames:v', '1', out
  ]);
}

function fetchMitSlide(i, out) {
  if (existsSync(out)) return;
  execFileSync('curl', ['-sf', '-o', out, `${MIT_BASE}/slide-${i}.jpg`]);
}

function buildDataset(name, count, slidePath) {
  const rng = mulberry32(SEED + (name === 'mit' ? 1 : 0));
  const durations = Array.from({ length: count }, () => Math.round((4 + rng() * 8) * 10) / 10);
  const transitions = [];
  let t = 0;
  for (const d of durations) { transitions.push(Math.round(t * 10) / 10); t += d; }
  const total = Math.round(t * 10) / 10;

  const listFile = join(FIXTURES, `${name}-concat.txt`);
  const lines = durations.map((d, i) => `file '${slidePath(i + 1)}'\nduration ${d}`);
  lines.push(`file '${slidePath(count)}'`); // concat demuxer needs the last entry repeated
  writeFileSync(listFile, lines.join('\n') + '\n');

  const src = ['-f', 'concat', '-safe', '0', '-i', listFile];
  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'];

  console.log(`[${name}] clean`);
  ff([...src, '-vf', 'fps=10,scale=960:540,format=yuv420p', ...enc, '-crf', '23', join(FIXTURES, `${name}-clean.mp4`)]);

  console.log(`[${name}] noisy`);
  ff([...src, '-vf', 'fps=10,scale=480:270,scale=960:540,format=yuv420p', ...enc, '-crf', '45', join(FIXTURES, `${name}-noisy.mp4`)]);

  console.log(`[${name}] overlay`);
  ff([
    ...src,
    '-f', 'lavfi', '-i', 'testsrc=size=176x99:rate=10',
    '-filter_complex',
    '[0:v]fps=10,scale=960:540[base];[base][1:v]overlay=x=W-w-24:y=H-h-24+8*sin(t*3):shortest=1,format=yuv420p[out]',
    '-map', '[out]', ...enc, '-crf', '23', join(FIXTURES, `${name}-overlay.mp4`)
  ]);

  writeFileSync(
    join(FIXTURES, `${name}-ground-truth.json`),
    JSON.stringify({ dataset: name, seed: SEED, slideCount: count, durations, transitions, totalSeconds: total }, null, 2)
  );
  console.log(`[${name}] ${count} slides, ${total}s, ground truth written`);
}

mkdirSync(join(FIXTURES, 'synthetic-slides'), { recursive: true });
mkdirSync(join(FIXTURES, 'mit-slides'), { recursive: true });

{
  const rng = mulberry32(SEED + 100); // slide appearance only; not part of GT
  for (let i = 1; i <= SYNTH_COUNT; i++) synthSlide(i, rng, join(FIXTURES, 'synthetic-slides', `slide-${i}.png`));
}
console.log('[synthetic] slides drawn');
for (let i = 1; i <= MIT_COUNT; i++) fetchMitSlide(i, join(FIXTURES, 'mit-slides', `slide-${i}.jpg`));
console.log('[mit] slides fetched (MIT OCW 6.0001 L1, CC BY-NC-SA 4.0, via video2any.com)');

buildDataset('synthetic', SYNTH_COUNT, i => join(FIXTURES, 'synthetic-slides', `slide-${i}.png`));
buildDataset('mit', MIT_COUNT, i => join(FIXTURES, 'mit-slides', `slide-${i}.jpg`));
console.log('done');
