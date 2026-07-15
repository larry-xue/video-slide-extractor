import { Buffer } from 'node:buffer';

import {
  DEFAULTS,
  createSlideDetector,
  extractSlideIndices,
  frameDiff,
  type FrameDiffResult,
  type SlideDetectionResult,
  type SlideDetectorOptions,
} from 'video-slide-extractor';

const options: SlideDetectorOptions = {
  blockSize: DEFAULTS.blockSize,
  blockDelta: 12,
  changedRatio: 0.05,
};

const clamped = new Uint8ClampedArray(16 * 16 * 4);
const bytes = new Uint8Array(clamped);
const buffer = Buffer.from(bytes);

const diff: FrameDiffResult = frameDiff(clamped, buffer, 16, 16, options);
const detect = createSlideDetector(16, 16, options);
const result: SlideDetectionResult = detect(bytes);
const indices: number[] = extractSlideIndices([clamped, buffer], 16, 16);

void diff;
void result;
void indices;
