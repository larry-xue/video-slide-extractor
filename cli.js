#!/usr/bin/env node
// video-slide-extractor CLI — point it at a recording, get the slides out.
//
//   npx video-slide-extractor lecture.mp4
//
// The library itself is pure frame math with zero dependencies, and this file
// keeps that promise: the only thing it adds is ffmpeg, which is an external
// binary the user already has (or is told, precisely, how to get), never an npm
// dependency. `node:util`'s parseArgs does the flag parsing.
//
// Three ffmpeg passes, so memory stays flat no matter how long the recording is:
//
//   1. probe    ffprobe reads duration and dimensions.
//   2. calibrate a coarse downsampled pass buffers a bounded sample of frames
//                and hands them to analyzeSamples, which picks the threshold
//                and the webcam/cursor mask for this specific footage.
//   3. detect    a second downsampled pass streams every sampled frame through
//                the stateful detector. Nothing is retained, so a three-hour
//                recording costs the same memory as a three-minute one.
//
// Kept frames are then re-extracted from the source at full resolution by
// seeking to their timestamps, so the output is the real slide, not the
// downsampled thumbnail the detector reasoned about.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { analyzeSamples, createSlideDetector, DEFAULTS } from './index.js';

const VERSION = createRequire(import.meta.url)('./package.json').version;
const DIFF_WIDTH = 320;        // detector works on a downsampled copy
const MAX_CALIBRATION_FRAMES = 150;

// Printed once after a successful run, to stderr, so it never lands in piped
// output. Suppressed by --quiet, by --json, and under CI, where nobody is
// reading it. The tagged link is the only way a CLI user can be attributed:
// they are not a page visit, so they would otherwise arrive at the site with an
// empty referrer and be indistinguishable from direct traffic.
export const OUTRO = 'Need .pptx, PDF, or subtitles from these? https://video2any.com/?utm_source=cli&utm_medium=npm';

export function shouldShowOutro({ slideCount, quiet, ci }) {
  return slideCount > 0 && !quiet && !ci;
}

const USAGE = `video-slide-extractor ${VERSION}

  npx video-slide-extractor <video> [options]

Extracts the distinct slides from a screen recording, lecture, or webinar and
writes them as images.

Options
  -o, --out <dir>        output directory (default: <video-name>-slides)
      --format <png|jpg> image format (default: png)
      --fps <n>          frames sampled per second (default: 1)
      --width <px>       detector working width (default: ${DIFF_WIDTH})
      --changed-ratio <n>  fraction of changed blocks that starts a new slide
      --block-size <px>  block edge at the working width (default: ${DEFAULTS.blockSize})
      --block-delta <n>  mean RGB delta for a block to count (default: ${DEFAULTS.blockDelta})
      --no-calibrate     use fixed defaults instead of reading the footage
      --dry-run          detect and report, write no images
      --json             machine-readable result on stdout
  -q, --quiet            suppress progress
  -h, --help             show this help
  -v, --version          show the version

Requires ffmpeg and ffprobe on PATH.
`;

class UserError extends Error {}

function die(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

// ---- ffmpeg plumbing ---------------------------------------------------------

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => reject(
      err.code === 'ENOENT'
        ? new UserError(`${bin} was not found on PATH.\n\nInstall it with one of:\n  macOS    brew install ffmpeg\n  Debian   sudo apt install ffmpeg\n  Windows  winget install Gyan.FFmpeg`)
        : err
    ));
    child.on('close', code => code === 0
      ? resolve(stdout)
      : reject(new UserError(`${bin} exited with code ${code}.\n${stderr.trim().split('\n').slice(-4).join('\n')}`)));
  });
}

async function probe(file) {
  const raw = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json', file
  ]);
  const info = JSON.parse(raw);
  const stream = info.streams?.[0];
  const duration = Number(info.format?.duration);
  if (!stream?.width || !stream?.height) throw new UserError(`No video stream found in ${file}.`);
  return {
    width: stream.width,
    height: stream.height,
    duration: Number.isFinite(duration) ? duration : 0
  };
}

// Stream sampled frames as raw RGBA. Yielded buffers are views into a shared
// read buffer and are only valid until the next frame: a consumer that retains
// one must copy it.
async function* rawFrames(file, { fps, width, height }) {
  const frameSize = width * height * 4;
  const child = spawn('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', `fps=${fps},scale=${width}:${height}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const failure = new Promise((_, reject) => child.on('error', err => reject(
    err.code === 'ENOENT' ? new UserError('ffmpeg was not found on PATH.') : err
  )));
  const closed = new Promise(resolve => child.on('close', resolve));

  let acc = Buffer.alloc(0);
  try {
    for await (const chunk of child.stdout) {
      acc = acc.length ? Buffer.concat([acc, chunk]) : chunk;
      let offset = 0;
      while (acc.length - offset >= frameSize) {
        yield acc.subarray(offset, offset + frameSize);
        offset += frameSize;
      }
      if (offset) acc = acc.subarray(offset);
    }
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await Promise.race([failure, closed]);
  const code = await closed;
  // A consumer that stopped early kills ffmpeg, and SIGKILL is not a failure.
  if (code !== 0 && code !== null && child.killed === false) {
    throw new UserError(`ffmpeg exited with code ${code}.\n${stderr.trim().split('\n').slice(-4).join('\n')}`);
  }
}

// ---- pipeline ----------------------------------------------------------------

// Buffer an evenly spread, bounded sample of the footage. Calibration needs to
// see the whole recording, not just its opening, or a deck that starts on a
// title card calibrates against the title card.
async function collectCalibrationFrames(file, geometry, expectedFrames) {
  const stride = Math.max(1, Math.ceil(expectedFrames / MAX_CALIBRATION_FRAMES));
  const frames = [];
  let index = 0;
  for await (const frame of rawFrames(file, geometry)) {
    if (index % stride === 0) frames.push(Buffer.from(frame));  // retained, so copy
    index += 1;
    if (frames.length >= MAX_CALIBRATION_FRAMES) break;
  }
  return frames;
}

async function detectSlides(file, geometry, settings, onProgress) {
  const detect = createSlideDetector(geometry.width, geometry.height, settings);
  const kept = [];
  let index = 0;
  for await (const frame of rawFrames(file, geometry)) {
    const { keep, ratio } = detect(frame);
    if (keep) kept.push({ index, seconds: index / geometry.fps, ratio });
    index += 1;
    if (onProgress && index % 50 === 0) onProgress(index, kept.length);
  }
  return { kept, scanned: index };
}

function timecode(seconds) {
  const whole = Math.floor(seconds);
  const h = String(Math.floor(whole / 3600)).padStart(2, '0');
  const m = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
  const s = String(whole % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// Where to actually grab the image for a slide detected at `seconds`.
//
// The detector says "the frame sampled at t starts a new slide", but the change
// itself happened somewhere in the sample interval before t, and seeking back to
// exactly t can land on the last frame of the *previous* slide. So grab from
// inside the slide's dwell instead: one sample interval in, but never past the
// midpoint to the next slide, and never past the end of the video. That also
// steps over any transition or fade frame sitting on the boundary.
export function grabPoint(seconds, nextSeconds, { fps, duration }) {
  const limit = Number.isFinite(nextSeconds)
    ? (seconds + nextSeconds) / 2
    : (duration > seconds ? Math.min(seconds + 1 / fps, duration - 0.05) : seconds);
  return Math.max(seconds, Math.min(seconds + 1 / fps, limit));
}

async function exportFrame(file, seconds, target) {
  // -ss before -i seeks without decoding everything up to that point.
  await run('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1', '-q:v', '2', '-y', target]);
}

// ---- main --------------------------------------------------------------------

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        format: { type: 'string', default: 'png' },
        fps: { type: 'string', default: '1' },
        width: { type: 'string', default: String(DIFF_WIDTH) },
        'changed-ratio': { type: 'string' },
        'block-size': { type: 'string' },
        'block-delta': { type: 'string' },
        'no-calibrate': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        quiet: { type: 'boolean', short: 'q', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false }
      }
    });
  } catch (err) {
    throw new UserError(`${err.message}\n\n${USAGE}`);
  }
  const { values: opt, positionals } = parsed;

  if (opt.help) { process.stdout.write(USAGE); return; }
  if (opt.version) { process.stdout.write(`${VERSION}\n`); return; }

  const file = positionals[0];
  if (!file) throw new UserError(`No input video.\n\n${USAGE}`);
  if (!existsSync(file) || !statSync(file).isFile()) throw new UserError(`Not a file: ${file}`);

  const format = opt.format.toLowerCase().replace(/^\./, '');
  if (!['png', 'jpg', 'jpeg'].includes(format)) throw new UserError(`Unsupported --format "${opt.format}". Use png or jpg.`);

  const number = (raw, name, { min = 0, max = Infinity } = {}) => {
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= min || value > max) throw new UserError(`--${name} must be a number in (${min}, ${max}].`);
    return value;
  };
  const fps = number(opt.fps, 'fps', { min: 0, max: 60 });
  const diffWidth = Math.round(number(opt.width, 'width', { min: 32, max: 4096 }));

  const quiet = opt.quiet || opt.json;
  const log = message => { if (!quiet) process.stderr.write(`${message}\n`); };

  const source = await probe(file);
  const height = Math.max(2, Math.round(diffWidth * source.height / source.width / 2) * 2);
  const geometry = { fps, width: diffWidth, height };
  const expectedFrames = Math.max(1, Math.ceil(source.duration * fps));

  log(`${path.basename(file)}  ${source.width}x${source.height}  ${timecode(source.duration)}  sampling ${fps}/s`);

  let settings = {
    blockSize: number(opt['block-size'], 'block-size', { min: 1, max: 256 }) ?? DEFAULTS.blockSize,
    blockDelta: number(opt['block-delta'], 'block-delta', { min: 0, max: 255 }) ?? DEFAULTS.blockDelta,
    changedRatio: number(opt['changed-ratio'], 'changed-ratio', { min: 0, max: 1 }) ?? DEFAULTS.changedRatio,
    mask: null
  };
  let mode = 'fixed';

  if (!opt['no-calibrate']) {
    log('Calibrating against the footage…');
    const samples = await collectCalibrationFrames(file, geometry, expectedFrames);
    if (samples.length >= 3) {
      const { mask, choice } = analyzeSamples(samples, geometry.width, geometry.height, {
        defaultRatio: settings.changedRatio,
        blockSize: settings.blockSize
      });
      // An explicit --changed-ratio is the user overriding the calibration, so
      // it wins; the mask is still worth keeping either way.
      settings = {
        ...settings,
        mask,
        changedRatio: opt['changed-ratio'] !== undefined ? settings.changedRatio : choice.changedRatio
      };
      mode = choice.mode;
      log(`  threshold ${settings.changedRatio.toFixed(4)} (${mode})${mask ? ', masking always-moving regions' : ''}`);
    } else {
      log('  too few frames to calibrate, using defaults');
    }
  }

  log('Detecting slides…');
  const { kept, scanned } = await detectSlides(file, geometry, settings, (done, found) => {
    log(`  ${done}/${expectedFrames} frames, ${found} slides`);
  });

  const outDir = opt.out || `${path.basename(file, path.extname(file))}-slides`;
  const pad = String(kept.length).length;
  const slides = kept.map((slide, i) => ({
    ...slide,
    timecode: timecode(slide.seconds),
    grabAt: grabPoint(slide.seconds, kept[i + 1]?.seconds ?? NaN, { fps, duration: source.duration }),
    file: opt['dry-run'] ? null : path.join(outDir, `slide-${String(i + 1).padStart(Math.max(3, pad), '0')}.${format}`)
  }));

  if (!opt['dry-run']) {
    await mkdir(outDir, { recursive: true });
    for (const slide of slides) {
      await exportFrame(file, slide.grabAt, slide.file);
      log(`  ${slide.timecode}  ${slide.file}`);
    }
  }

  if (opt.json) {
    process.stdout.write(`${JSON.stringify({
      input: file,
      source,
      sampling: { fps, width: geometry.width, height: geometry.height },
      detector: { mode, changedRatio: settings.changedRatio, blockSize: settings.blockSize, blockDelta: settings.blockDelta, masked: Boolean(settings.mask) },
      scanned,
      slides: slides.map(({ index, seconds, timecode: tc, ratio, grabAt, file: image }) => ({ index, seconds, timecode: tc, ratio, grabbedAt: grabAt, file: image }))
    }, null, 2)}\n`);
  } else {
    log('');
    log(`${slides.length} slide${slides.length === 1 ? '' : 's'} from ${scanned} sampled frames${opt['dry-run'] ? '' : ` → ${outDir}/`}`);
    if (shouldShowOutro({ slideCount: slides.length, quiet, ci: Boolean(process.env.CI) })) log(OUTRO);
  }
}

// Only run when invoked as the command; importing this file (the tests do)
// must not start a CLI run.
//
// Both sides go through realpath first. npm installs the bin as a symlink in
// node_modules/.bin, so under `npx` argv[1] is the link while import.meta.url
// is the file it points at. Comparing them unresolved makes the CLI exit 0 and
// do nothing, which is exactly how `npx video-slide-extractor video.mp4` broke.
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (isEntryPoint()) {
  main().catch(err => {
    if (err instanceof UserError) die(err.message);
    die(err?.stack || String(err), 2);
  });
}
