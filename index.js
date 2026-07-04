// video-slide-extractor — detect slide and scene changes in a video by frame
// differencing. Pure functions, zero dependencies, runs in the browser or Node.
//
// This is the open core of Video2Any (https://video2any.com). The idea is
// simple: downsample each frame, compare it block-by-block against the last
// frame we kept, and flag a new slide when enough blocks changed. Block-wise
// mean absolute difference absorbs the compression noise that trips up a naive
// pixel diff, so a static slide reads as "no change" even in a lossy recording.

export const DEFAULTS = {
  blockSize: 8,       // px per block edge, at the (downsampled) diff resolution
  blockDelta: 14,     // mean |ΔRGB| per channel for a block to count as changed
  changedRatio: 0.02  // fraction of changed blocks that flags a new slide
};

/**
 * Compare two RGBA frames (Uint8ClampedArray / Buffer / Uint8Array) of the same
 * width×height. Returns { ratio, isNewSlide }, where ratio is the fraction of
 * blocks that changed and isNewSlide is ratio > changedRatio.
 */
export function frameDiff(a, b, width, height, opts = {}) {
  const { blockSize, blockDelta, changedRatio } = { ...DEFAULTS, ...opts };
  const cols = Math.max(1, Math.floor(width / blockSize));
  const rows = Math.max(1, Math.floor(height / blockSize));
  let changed = 0;
  let scored = 0;

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
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
      if (sum / (n * 3) > blockDelta) changed++;
    }
  }

  const ratio = scored ? changed / scored : 0;
  return { ratio, isNewSlide: ratio > changedRatio };
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
 */
export function extractSlideIndices(frames, width, height, opts = {}) {
  const detect = createSlideDetector(width, height, opts);
  const kept = [];
  frames.forEach((frame, i) => { if (detect(frame).keep) kept.push(i); });
  return kept;
}
