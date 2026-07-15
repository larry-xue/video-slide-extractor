# Evaluate a Slide-Change Detector

A useful slide detector should be measured against labeled transitions, not
only demonstrated on a hand-picked clip. This protocol keeps evaluations of
`video-slide-extractor` reproducible and makes threshold changes reviewable.

## 1. Label the source video

Create a CSV with one row per ground-truth slide:

```csv
slide_id,start_seconds,end_seconds,notes
1,0.0,42.4,title slide
2,42.4,88.1,contains incremental bullet builds
```

Use recordings you have permission to redistribute, or publish only labels and
source links when redistribution is not allowed. Record the source URL, license,
duration, resolution, and date accessed.

## 2. Freeze the sampling setup

Report all inputs that affect the result:

- sample interval;
- comparison width and height;
- `blockSize`, `blockDelta`, and `changedRatio`;
- crop or mask applied before detection;
- browser/runtime and package version.

Do not compare two detectors with different sampling intervals without saying
so. A detector cannot recover a slide that was never sampled.

## 3. Match detections to labels

Give each detected timestamp a tolerance window, such as two seconds, and match
it to at most one ground-truth transition. Then report:

| Metric | Definition |
| --- | --- |
| True positive | A detection matched to a labeled slide transition |
| False positive | An unmatched detection, often a build or transition frame |
| False negative | A labeled transition with no matched detection |
| Precision | `TP / (TP + FP)` |
| Recall | `TP / (TP + FN)` |
| F1 | Harmonic mean of precision and recall |
| Duplicate rate | Repeated slide images divided by exported slide images |

Also report transition-frame captures separately. A timestamp can be close to
the correct transition while still producing an unusable half-faded image.

## 4. Keep failure classes visible

Tag false positives and false negatives with the cause when possible:

- incremental builds or animations;
- crossfades and wipes;
- cursor or webcam motion;
- camera footage around a projected screen;
- compression noise;
- slides revisited later in the recording;
- sampling interval too wide.

This package performs consecutive change detection only. It does not collapse
transitions, perform global perceptual deduplication, crop the slide region, or
choose a clean high-resolution export frame. Score those pipeline stages
separately when evaluating a complete video-to-slides product.

## 5. Publish enough evidence to reproduce the result

For every reported benchmark, include the labels, detector configuration,
detected timestamps, metric calculation, package version, and known blockers.
Raw videos are optional when their license or privacy prevents redistribution.
