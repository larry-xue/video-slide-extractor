import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULTS } from '../index.js';

const DEFAULTS_CHANGED_RATIO = DEFAULTS.changedRatio;

import {
  analyzeSamples,
  buildActivityMask,
  calibrateThreshold,
  chooseThreshold,
  createSlideDetector,
  extractSlideIndices,
  frameDiff,
} from '../index.js';

function solidFrame(width, height, r, g, b) {
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) {
    frame[i] = r;
    frame[i + 1] = g;
    frame[i + 2] = b;
    frame[i + 3] = 255;
  }
  return frame;
}

test('identical frames have a zero change ratio', () => {
  const frame = solidFrame(16, 16, 10, 20, 30);
  assert.deepEqual(frameDiff(frame, frame, 16, 16), {
    ratio: 0,
    isNewSlide: false,
  });
});

test('a full-frame color change is detected', () => {
  const before = solidFrame(16, 16, 10, 20, 30);
  const after = solidFrame(16, 16, 200, 210, 220);
  assert.deepEqual(frameDiff(before, after, 16, 16), {
    ratio: 1,
    isNewSlide: true,
  });
});

test('the detector compares against the last kept frame', () => {
  const first = solidFrame(16, 16, 10, 20, 30);
  const same = solidFrame(16, 16, 10, 20, 30);
  const second = solidFrame(16, 16, 200, 210, 220);
  const detect = createSlideDetector(16, 16);

  assert.equal(detect(first).keep, true);
  assert.equal(detect(same).keep, false);
  assert.equal(detect(second).keep, true);
});

test('extractSlideIndices returns one index per distinct synthetic slide', () => {
  const a = solidFrame(16, 16, 10, 20, 30);
  const b = solidFrame(16, 16, 200, 210, 220);
  assert.deepEqual(extractSlideIndices([a, a, b, b], 16, 16), [0, 2]);
});

// --- masking -----------------------------------------------------------
//
// The case these exist for: a recording whose slides are still but whose
// webcam corner never is. Scored naively the corner alone can clear the
// threshold on every sample, so every sample becomes a slide.

/** A frame that is `bg` everywhere except a `size`×`size` top-left patch. */
function framePatch(width, height, bg, patch, size) {
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inPatch = x < size && y < size;
      const [r, g, b] = inPatch ? patch : bg;
      const i = (y * width + x) * 4;
      frame[i] = r; frame[i + 1] = g; frame[i + 2] = b; frame[i + 3] = 255;
    }
  }
  return frame;
}

const BG_A = [10, 20, 30];
const BG_B = [200, 210, 220];

/** Ten frames: the corner flickers every frame, the slide changes once. */
function webcamCornerFrames() {
  const frames = [];
  for (let i = 0; i < 10; i++) {
    const bg = i < 5 ? BG_A : BG_B;              // one slide change, at index 5
    const patch = i % 2 ? [0, 0, 0] : [255, 255, 255]; // corner, every frame
    frames.push(framePatch(32, 32, bg, patch, 8));
  }
  return frames;
}

test('collect returns per-block flags, and only when asked', () => {
  const frames = webcamCornerFrames();
  assert.equal('flags' in frameDiff(frames[0], frames[1], 32, 32), false);

  const { flags } = frameDiff(frames[0], frames[1], 32, 32, { collect: true });
  assert.equal(flags.length, 16); // 32/8 = 4 blocks a side
  assert.equal(flags[0], 1);      // the corner changed
  assert.equal(flags[15], 0);     // the far corner did not
});

test('buildActivityMask masks the region that never stops moving', () => {
  const mask = buildActivityMask(webcamCornerFrames(), 32, 32);
  assert.ok(mask, 'a mask should be found');
  assert.equal(mask[0], 1, 'the flickering corner is masked');
  assert.equal(mask[15], 0, 'the still region is not');
});

test('a masked block is left out of the ratio entirely', () => {
  const frames = webcamCornerFrames();
  const mask = buildActivityMask(frames, 32, 32);
  // Two frames on the same slide, differing only in the corner.
  const unmasked = frameDiff(frames[0], frames[1], 32, 32).ratio;
  const masked = frameDiff(frames[0], frames[1], 32, 32, { mask }).ratio;
  assert.ok(unmasked > 0, 'the corner alone moves the ratio');
  assert.equal(masked, 0, 'and masking it takes the ratio to zero');
});

test('buildActivityMask returns null rather than blanking the frame', () => {
  // Everything moves: the moving part is the subject, so there is nothing to
  // mask. Masking here would hide the changes the caller is looking for.
  const frames = [];
  for (let i = 0; i < 10; i++) {
    frames.push(solidFrame(32, 32, i * 25, i * 20, i * 15));
  }
  assert.equal(buildActivityMask(frames, 32, 32), null);
});

test('buildActivityMask needs enough frames to judge', () => {
  assert.equal(buildActivityMask(webcamCornerFrames().slice(0, 4), 32, 32), null);
});

test('masking is what makes the slide change the only detection', () => {
  const frames = webcamCornerFrames();
  const noisy = extractSlideIndices(frames, 32, 32);
  const clean = extractSlideIndices(frames, 32, 32, { calibrate: true });
  assert.ok(noisy.length > 2, 'unmasked, the flicker keeps nearly every frame');
  assert.deepEqual(clean, [0, 5], 'calibrated, only the real slide change');
});

// --- thresholds --------------------------------------------------------

test('calibrateThreshold splits a bimodal distribution between the clusters', () => {
  const ratios = [0.001, 0.002, 0.001, 0.003, 0.002, 0.001, 0.4, 0.38, 0.42];
  const t = calibrateThreshold(ratios);
  assert.ok(t > 0.003 && t < 0.38, `expected a split in the gap, got ${t}`);
});

test('calibrateThreshold refuses a distribution that is not bimodal', () => {
  assert.equal(calibrateThreshold([0.01, 0.011, 0.012, 0.0105, 0.0115, 0.0108]), null);
  assert.equal(calibrateThreshold([0.01, 0.02, 0.03]), null, 'and too few samples');
});

test('chooseThreshold names the regime it decided on', () => {
  const deck = [0.001, 0.002, 0.001, 0.003, 0.002, 0.001, 0.4, 0.38, 0.42];
  assert.equal(chooseThreshold(deck).mode, 'bimodal');

  const still = new Array(12).fill(0.001);
  assert.equal(chooseThreshold(still).mode, 'static');
  assert.equal(chooseThreshold(still).changedRatio, DEFAULTS_CHANGED_RATIO);

  const camera = [0.3, 0.35, 0.31, 0.4, 0.33, 0.36, 0.34, 0.38];
  const motion = chooseThreshold(camera);
  assert.equal(motion.mode, 'motion');
  assert.ok(motion.changedRatio > 0.25, 'well above the default, or everything is a cut');

  assert.equal(chooseThreshold([0.1, 0.2]).mode, 'default', 'too few to classify');
});

test('chooseThreshold honours the caller fallback', () => {
  assert.equal(chooseThreshold([0.1, 0.2], { defaultRatio: 0.5 }).changedRatio, 0.5);
});

// --- calibration entry point -------------------------------------------

test('analyzeSamples keeps the mask when it makes the video deck-like', () => {
  const { mask, choice } = analyzeSamples(webcamCornerFrames(), 32, 32);
  assert.ok(mask, 'the webcam corner is masked away');
  assert.ok(choice.mode === 'bimodal' || choice.mode === 'static', choice.mode);
});

test('analyzeSamples discards the mask on genuine motion footage', () => {
  const frames = [];
  for (let i = 0; i < 12; i++) frames.push(solidFrame(32, 32, i * 20, 255 - i * 15, i * 10));
  const { mask, choice } = analyzeSamples(frames, 32, 32);
  assert.equal(mask, null, 'the moving region is the subject here');
  assert.equal(choice.mode, 'motion');
});
