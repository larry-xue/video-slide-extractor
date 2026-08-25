import { Buffer } from 'node:buffer';

import {
  DEFAULTS,
  analyzeSamples,
  buildActivityMask,
  calibrateThreshold,
  chooseThreshold,
  createSlideDetector,
  extractSlideIndices,
  frameDiff,
  type BlockMask,
  type FrameDiffResult,
  type SampleAnalysis,
  type SlideDetectionResult,
  type SlideDetectorOptions,
  type ThresholdChoice,
  type ThresholdMode,
} from 'video-slide-extractor';

const options: SlideDetectorOptions = {
  blockSize: DEFAULTS.blockSize,
  blockDelta: 12,
  changedRatio: 0.05,
};

const clamped = new Uint8ClampedArray(16 * 16 * 4);
const bytes = new Uint8Array(clamped);
const buffer = Buffer.from(bytes);
const frames = [clamped, buffer];

const diff: FrameDiffResult = frameDiff(clamped, buffer, 16, 16, options);
const detect = createSlideDetector(16, 16, options);
const result: SlideDetectionResult = detect(bytes);
const indices: number[] = extractSlideIndices(frames, 16, 16);

// flags is optional: present only when collected.
const collected: FrameDiffResult = frameDiff(clamped, buffer, 16, 16, { collect: true });
const flags: BlockMask | undefined = collected.flags;

const mask: BlockMask | null = buildActivityMask(frames, 16, 16, { activeFrac: 0.5 });
const masked: FrameDiffResult = frameDiff(clamped, buffer, 16, 16, { mask });

const split: number | null = calibrateThreshold([0.01, 0.4], { min: 0.005 });
const choice: ThresholdChoice = chooseThreshold([0.01, 0.4], { defaultRatio: 0.02 });
const mode: ThresholdMode = choice.mode;

const analysis: SampleAnalysis = analyzeSamples(frames, 16, 16, { defaultRatio: 0.02 });
const calibrated: number[] = extractSlideIndices(frames, 16, 16, { calibrate: true });

void diff; void result; void indices; void flags; void masked; void mask;
void split; void mode; void analysis; void calibrated;
