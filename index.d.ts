export interface SlideDetectorOptions {
  /** Block edge length in pixels at the downsampled comparison resolution. */
  blockSize?: number;
  /** Mean absolute RGB delta required for a block to count as changed. */
  blockDelta?: number;
  /** Fraction of changed blocks required to keep a frame. */
  changedRatio?: number;
}

export interface FrameDiffResult {
  ratio: number;
  isNewSlide: boolean;
}

export interface SlideDetectionResult {
  keep: boolean;
  ratio: number;
}

export type RgbaFrame = Uint8Array | Uint8ClampedArray;

export const DEFAULTS: Readonly<Required<SlideDetectorOptions>>;

export function frameDiff(
  a: RgbaFrame,
  b: RgbaFrame,
  width: number,
  height: number,
  options?: SlideDetectorOptions,
): FrameDiffResult;

export function createSlideDetector(
  width: number,
  height: number,
  options?: SlideDetectorOptions,
): (frame: RgbaFrame) => SlideDetectionResult;

export function extractSlideIndices(
  frames: readonly RgbaFrame[],
  width: number,
  height: number,
  options?: SlideDetectorOptions,
): number[];
