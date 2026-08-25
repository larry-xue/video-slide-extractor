export type RgbaFrame = Uint8Array | Uint8ClampedArray;

/** One byte per block, 1 meaning "leave this block out of the comparison". */
export type BlockMask = Uint8Array;

export interface SlideDetectorOptions {
  /** Block edge length in pixels at the downsampled comparison resolution. */
  blockSize?: number;
  /** Mean absolute RGB delta required for a block to count as changed. */
  blockDelta?: number;
  /** Fraction of changed blocks required to keep a frame. */
  changedRatio?: number;
  /** Blocks to exclude from scoring entirely — see buildActivityMask. */
  mask?: BlockMask | null;
}

export interface FrameDiffOptions extends SlideDetectorOptions {
  /** Also return `flags`: one byte per block, 1 where that block changed. */
  collect?: boolean;
}

export interface FrameDiffResult {
  ratio: number;
  isNewSlide: boolean;
  /** Present only when `collect: true` was passed. */
  flags?: BlockMask;
}

export interface SlideDetectionResult {
  keep: boolean;
  ratio: number;
}

export interface ActivityMaskOptions {
  /** Share of frame pairs a block must change in to be called always-moving. */
  activeFrac?: number;
  /** Give up and return null if the mask would cover more than this share. */
  maxMaskFrac?: number;
  blockSize?: number;
}

export interface CalibrateThresholdOptions {
  min?: number;
  max?: number;
}

/** Which regime the footage was classified as. See chooseThreshold. */
export type ThresholdMode = 'bimodal' | 'static' | 'motion' | 'default';

export interface ThresholdChoice {
  changedRatio: number;
  mode: ThresholdMode;
}

export interface AnalyzeSamplesOptions {
  /** Threshold to fall back to when the footage cannot be calibrated. */
  defaultRatio?: number;
  blockSize?: number;
}

export interface SampleAnalysis {
  /** Null when nothing should be masked — see buildActivityMask. */
  mask: BlockMask | null;
  choice: ThresholdChoice;
}

export interface ExtractSlideIndicesOptions extends SlideDetectorOptions {
  /** Calibrate against these same frames before detecting. */
  calibrate?: boolean;
}

export const DEFAULTS: Readonly<{
  blockSize: number;
  blockDelta: number;
  changedRatio: number;
}>;

export function frameDiff(
  a: RgbaFrame,
  b: RgbaFrame,
  width: number,
  height: number,
  options?: FrameDiffOptions,
): FrameDiffResult;

export function buildActivityMask(
  frames: readonly RgbaFrame[],
  width: number,
  height: number,
  options?: ActivityMaskOptions,
): BlockMask | null;

export function calibrateThreshold(
  ratios: readonly number[],
  options?: CalibrateThresholdOptions,
): number | null;

export function chooseThreshold(
  ratios: readonly number[],
  options?: { defaultRatio?: number },
): ThresholdChoice;

export function analyzeSamples(
  frames: readonly RgbaFrame[],
  width: number,
  height: number,
  options?: AnalyzeSamplesOptions,
): SampleAnalysis;

export function createSlideDetector(
  width: number,
  height: number,
  options?: SlideDetectorOptions,
): (frame: RgbaFrame) => SlideDetectionResult;

export function extractSlideIndices(
  frames: readonly RgbaFrame[],
  width: number,
  height: number,
  options?: ExtractSlideIndicesOptions,
): number[];
