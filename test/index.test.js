import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
