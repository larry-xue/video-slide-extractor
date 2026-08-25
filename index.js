// video-slide-extractor — detect slide and scene changes in a video by frame
// differencing. Pure functions, zero dependencies, runs in the browser or Node.
//
// This is the open core of Video2Any (https://video2any.com). The idea is
// simple: downsample each frame, compare it block-by-block against the last
// frame we kept, and flag a new slide when enough blocks changed. Block-wise
// mean absolute difference absorbs the compression noise that trips up a naive
// pixel diff, so a static slide reads as "no change" even in a lossy recording.
//
// Two things break that simple version on real recordings, and both are
// handled here:
//
//   A webcam bubble, a cursor, or an animated logo changes in every single
//   frame. Scored naively it either drowns out the slide change or fires on
//   every sample. `buildActivityMask` finds the regions that never stop moving
//   and excludes them from scoring.
//
//   One fixed threshold does not fit both a slide deck and a talking head. A
//   deck is still most of the time and its slide changes stand clear of the
//   noise; camera footage moves constantly, so the same threshold either keeps
//   everything or nothing. `chooseThreshold` reads the distribution of diff
//   ratios and picks a threshold for the footage it was actually given.
//
// `analyzeSamples` runs both over a set of sample frames and hands back the
// mask and threshold to detect with — it is the entry point most callers want.

export const DEFAULTS = {
  blockSize: 8,       // px per block edge, at the (downsampled) diff resolution
  blockDelta: 14,     // mean |ΔRGB| per channel for a block to count as changed
  changedRatio: 0.02  // fraction of changed blocks that flags a new slide
};

/**
 * Compare two RGBA frames (Uint8ClampedArray / Buffer / Uint8Array) of the same
 * width×height. Returns { ratio, isNewSlide }, where ratio is the fraction of
 * scored blocks that changed and isNewSlide is ratio > changedRatio.
 *
 * `options.mask` is a Uint8Array with one entry per block, 1 meaning "ignore
 * this block" — masked blocks are left out of both the numerator and the
 * denominator, so a slide change still reads as a large ratio on a recording
 * whose webcam corner never stops moving. Build one with buildActivityMask.
 *
 * `options.collect` adds `flags` to the result: one byte per block, 1 where
 * that block changed. It is only present when asked for, so the default
 * result stays the two fields callers destructure.
 */
export function frameDiff(a, b, width, height, opts = {}) {
  const { blockSize, blockDelta, changedRatio, mask, collect } = { ...DEFAULTS, ...opts };
  const cols = Math.max(1, Math.floor(width / blockSize));
  const rows = Math.max(1, Math.floor(height / blockSize));
  let changed = 0;
  let scored = 0;
  const flags = collect ? new Uint8Array(rows * cols) : null;

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const bi = by * cols + bx;
      if (mask && mask[bi]) continue;
      scored++;
      let sum = 0;
      let n = 0;
      const y0 = by * blockSize;
      const x0 = bx * blockSize;
      for (let y = y0; y < y0 + blockSize && y < height; y++) {
        let i = (y * width + x0) * 4;
        for (let x = x0; x < x0 + blockSize && x < width; x++, i += 4) {
          sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          n++;
        }
      }
      if (sum / (n * 3) > blockDelta) {
        changed++;
        if (flags) flags[bi] = 1;
      }
    }
  }

  const ratio = scored ? changed / scored : 0;
  const out = { ratio, isNewSlide: ratio > changedRatio };
  if (flags) out.flags = flags;
  return out;
}

/**
 * Find the regions that are always moving, and return a mask that excludes
 * them. Blocks that change in more than `activeFrac` of consecutive frame
 * pairs are a webcam overlay, a cursor, a logo animation, or embedded video —
 * not slide content.
 *
 * Returns null when there is nothing to mask, when there are too few frames to
 * judge (under 8), or when the mask would cover more than `maxMaskFrac` of the
 * frame. That last case is the important one: if most of the picture is
 * moving, the moving part *is* the subject, and masking it would hide the very
 * changes you are looking for.
 *
 * @param {readonly RgbaFrame[]} frames ordered sample frames
 */
export function buildActivityMask(frames, width, height, opts = {}) {
  const { activeFrac = 0.5, maxMaskFrac = 0.35, blockSize = DEFAULTS.blockSize } = opts;
  if (frames.length < 8) return null;
  const cols = Math.max(1, Math.floor(width / blockSize));
  const rows = Math.max(1, Math.floor(height / blockSize));
  const counts = new Uint16Array(rows * cols);
  let pairs = 0;

  for (let i = 1; i < frames.length; i++) {
    const { flags } = frameDiff(frames[i - 1], frames[i], width, height, { blockSize, collect: true });
    pairs++;
    for (let b = 0; b < counts.length; b++) if (flags[b]) counts[b]++;
  }

  const mask = new Uint8Array(rows * cols);
  let masked = 0;
  for (let b = 0; b < counts.length; b++) {
    if (counts[b] / pairs > activeFrac) { mask[b] = 1; masked++; }
  }
  if (masked === 0 || masked / (rows * cols) > maxMaskFrac) return null;
  return mask;
}

/**
 * Given diff ratios sampled across a video, find the split between the "same
 * slide" noise cluster and the "slide changed" cluster (1-D Otsu).
 *
 * Returns null when the distribution is not bimodal enough to be worth
 * trusting — the caller should fall back to the default threshold rather than
 * act on a split that is really just noise. Use chooseThreshold if you want
 * that fallback handled for you.
 */
export function calibrateThreshold(ratios, { min = 0.005, max = 0.15 } = {}) {
  const v = ratios.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 6) return null;

  const prefix = [0];
  for (const r of v) prefix.push(prefix[prefix.length - 1] + r);
  const total = prefix[v.length];

  let best = -1, split = -1;
  for (let i = 1; i < v.length; i++) {
    const n0 = i, n1 = v.length - i;
    const m0 = prefix[i] / n0;
    const m1 = (total - prefix[i]) / n1;
    const sb = (n0 * n1) * (m1 - m0) * (m1 - m0);
    if (sb > best) { best = sb; split = i; }
  }

  const m0 = prefix[split] / split;
  const m1 = (total - prefix[split]) / (v.length - split);
  if (m1 < m0 * 3 + 0.004) return null; // clusters too close — not bimodal

  const t = (v[split - 1] + v[split]) / 2;
  return Math.min(max, Math.max(min, t));
}

/**
 * Pick a detection threshold for the footage these ratios came from. Three
 * regimes, reported as `mode` so you can tell what it decided:
 *
 *   `bimodal` — slide-deck content with a clean gap between the "same slide"
 *               and "new slide" clusters. Uses the Otsu split.
 *   `static`  — one slide and noise the whole way through. The default low
 *               threshold already keeps almost nothing, so it is left alone.
 *   `motion`  — talking-head or camera footage where everything moves. Only
 *               cuts clearly above the typical amount of motion count, so the
 *               threshold is median + 2·MAD rather than a fixed number.
 *   `default` — too few samples to classify.
 */
export function chooseThreshold(ratios, { defaultRatio = DEFAULTS.changedRatio } = {}) {
  const v = ratios.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 6) return { changedRatio: defaultRatio, mode: 'default' };

  // The regime decider is the fraction of frame pairs that are visually
  // still. Slide decks are mostly still; camera/talking-head footage is not.
  const staticFrac = v.filter(r => r < 0.02).length / v.length;

  if (staticFrac >= 0.6) {
    const bimodal = calibrateThreshold(ratios);
    if (bimodal != null) return { changedRatio: bimodal, mode: 'bimodal' };
    return { changedRatio: defaultRatio, mode: 'static' }; // still all the way through
  }

  const median = v[Math.floor(v.length / 2)];
  const mad = v.map(r => Math.abs(r - median)).sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const t = Math.min(0.65, Math.max(0.25, median + 2 * mad));
  return { changedRatio: t, mode: 'motion' };
}

/**
 * Calibrate against a set of sample frames: returns the `mask` and the
 * `choice` from chooseThreshold to detect with. This is the function most
 * callers want — pass its results straight into createSlideDetector.
 *
 * The mask is only kept when masking turns the video back into deck-like
 * content (mode `bimodal` or `static`). That is the webcam-overlay-on-slides
 * case, and masking is exactly right for it. For genuine motion footage the
 * always-moving region *is* the subject, so the mask is discarded even though
 * one could be built.
 */
export function analyzeSamples(frames, width, height, { defaultRatio, blockSize } = {}) {
  const base = blockSize ? { blockSize } : {};
  const pairRatios = (mask) => {
    const out = [];
    for (let i = 1; i < frames.length; i++) {
      out.push(frameDiff(frames[i - 1], frames[i], width, height, { ...base, mask }).ratio);
    }
    return out;
  };

  const candidate = buildActivityMask(frames, width, height, base);
  if (candidate) {
    const choice = chooseThreshold(pairRatios(candidate), { defaultRatio });
    if (choice.mode === 'bimodal' || choice.mode === 'static') {
      return { mask: candidate, choice };
    }
  }
  return { mask: null, choice: chooseThreshold(pairRatios(null), { defaultRatio }) };
}

/**
 * Stateful detector. Feed frames in order; each call returns { keep, ratio }.
 * keep === true means "this frame starts a new slide" (and becomes the new
 * reference frame). The first frame is always kept.
 */
export function createSlideDetector(width, height, opts = {}) {
  let lastKept = null;
  return function next(frame) {
    if (lastKept === null) {
      lastKept = frame.slice();
      return { keep: true, ratio: 1 };
    }
    const { ratio, isNewSlide } = frameDiff(lastKept, frame, width, height, opts);
    if (isNewSlide) {
      lastKept = frame.slice();
      return { keep: true, ratio };
    }
    return { keep: false, ratio };
  };
}

/**
 * Convenience: given an ordered array of RGBA frames, return the indices that
 * start a new slide.
 *
 * Pass `calibrate: true` to run analyzeSamples over the same frames first and
 * detect with the mask and threshold it finds, instead of the fixed defaults.
 */
export function extractSlideIndices(frames, width, height, opts = {}) {
  const { calibrate, ...rest } = opts;
  let settings = rest;
  if (calibrate) {
    const { mask, choice } = analyzeSamples(frames, width, height, {
      defaultRatio: rest.changedRatio,
      blockSize: rest.blockSize
    });
    settings = { ...rest, mask, changedRatio: rest.changedRatio ?? choice.changedRatio };
  }
  const detect = createSlideDetector(width, height, settings);
  const kept = [];
  frames.forEach((frame, i) => { if (detect(frame).keep) kept.push(i); });
  return kept;
}
