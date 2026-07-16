# video-slide-extractor - Extract Slides from Video with JavaScript

Detect **slide changes, scene cuts, and presentation transitions** in video
frames with JavaScript. Use it to build video-to-PowerPoint, lecture-to-slides,
screen-recording-to-PPT, and browser-based slide extraction tools.

The package is pure functions, **zero dependencies**, and runs in the browser or
in Node. Give it frames, get back the indices where a new slide begins.

It is a **change detector**, not a complete converter: it does not decode video,
capture clean export frames, remove non-consecutive duplicates, run OCR, or
write PowerPoint files. Those stages belong in the surrounding pipeline.

This is the open core of **[Video2Any](https://video2any.com)** — a tool that
turns videos, screen recordings, and meeting recordings into editable
PowerPoint decks, PDFs, and subtitles, entirely in your browser (your files
never leave your machine).

## See it working

- **Live demo** — drop any video into the
  [MP4 to PPT converter](https://video2any.com/tools/mp4-to-ppt); the
  detection stage is this algorithm.
- **Real output** — a full MIT lecture recording (6.0001, "What is
  Computation?") went in, and
  [46 extracted slides](https://video2any.com/decks/mit-what-is-computation)
  came out — browsable online, with a
  [downloadable sample .pptx](https://video2any.com/decks/mit-what-is-computation/video2any-sample.pptx).
- **Benchmark** — fixed-interval capture vs naive pixel diff vs this detector,
  on fixtures with construction-exact ground truth: [bench/](bench/README.md).

## When to use it

- Extract slides from lecture recordings, webinars, and conference talks.
- Detect presentation changes in screen recordings or meeting recordings.
- Build a video-to-PowerPoint, video-to-PDF, or video-to-Google-Slides pipeline.
- Find scene changes without sending private videos to an AI or cloud API.

## Install

```bash
npm install video-slide-extractor
```

## The idea

A slide deck recorded to video is *mostly still*: the same frame repeats for
seconds, then the whole surface changes at once when the presenter advances.
So we don't need "AI" to find the slides — we need a change detector that
ignores compression noise.

1. Downsample each frame to a small fixed size (e.g. 160×90) as RGBA.
2. Split it into 8×8 blocks. For each block, compute the **mean absolute
   difference** against the previous kept frame.
3. A block "changed" if that mean exceeds `blockDelta`. Averaging over a block
   absorbs the per-pixel noise a lossy codec introduces.
4. If the **fraction of changed blocks** exceeds `changedRatio`, this frame
   starts a new slide.

```mermaid
flowchart LR
    V[Video] -->|sample every N s| F[Frame<br/>160×90 RGBA]
    F --> B[8×8 blocks<br/>mean abs diff vs last kept]
    B --> C{"changed blocks<br/>&gt; changedRatio?"}
    C -->|yes| K[Keep frame =<br/>new slide starts]
    K -->|becomes reference| B
    C -->|no| D[Drop frame]
```

## Usage

### Browser — from a `<video>` element

```js
import { createSlideDetector } from 'video-slide-extractor';

const W = 160, H = 90;               // diff resolution — small is fine
const canvas = new OffscreenCanvas(W, H);
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const detect = createSlideDetector(W, H);

const slides = [];
for (let t = 0; t < video.duration; t += 2) {   // sample every 2s
  video.currentTime = t;
  await new Promise(r => (video.onseeked = r));
  ctx.drawImage(video, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H); // RGBA
  if (detect(data).keep) slides.push(t);         // new slide at time t
}
// `slides` now holds the timestamps of each distinct slide.
```

### Node — from frames you already have

```js
import { extractSlideIndices } from 'video-slide-extractor';

// frames: an ordered array of RGBA buffers (Uint8ClampedArray / Buffer),
// each width*height*4 bytes. Extract them however you like — e.g. with ffmpeg:
//   ffmpeg -i talk.mp4 -vf "fps=1/2,scale=160:90" -pix_fmt rgba -f rawvideo out.raw
const keep = extractSlideIndices(frames, 160, 90);
console.log('new slide at sample #', keep); // e.g. [0, 4, 9, 15]
```

## Guides

- [How to extract slides from a video in JavaScript](docs/extract-slides-from-video.md)
- [How video to PowerPoint conversion works](docs/video-to-powerpoint.md)
- [Detect slide changes in screen recordings](docs/screen-recording-to-slides.md)
- [Frame differencing vs AI for slide extraction](docs/frame-differencing-vs-ai.md)
- [How to evaluate a slide-change detector](docs/evaluation.md)

## How it compares — measured

`bench/` renders videos from known slide sequences (ground truth exact by
construction, no manual labeling) and scores three approaches under one frozen
sampling setup. Headline numbers from the 46-slide MIT deck fixture:

| Method | clean F1 | noisy F1 | overlay F1 |
| --- | --- | --- | --- |
| Fixed interval (10 s) | 0.68 | 0.68 | 0.68 |
| Naive pixel diff (2%) | 0.94 | 0.94 | 0.91 |
| **Block diff (this package, defaults)** | **0.97** | **0.97** | 0.54 |
| Block diff (`changedRatio: 0.10`) | 0.89 | 0.89 | **0.93** |

Two honest takeaways: block averaging wins on clean and compressed input, and
the default `changedRatio` floods on a persistent webcam overlay — thresholds
are inputs to report, not constants (the full product auto-calibrates and
masks; see below). Full tables, scripts, and methodology:
[bench/README.md](bench/README.md) · [bench/RESULTS.md](bench/RESULTS.md).

## Capability boundary

| Stage | This package | A complete converter still needs |
| --- | --- | --- |
| Decode/sample video | No | `<video>`/WebCodecs, FFmpeg, or another decoder |
| Detect consecutive visual changes | Yes | Feed ordered, equally sized RGBA frames |
| Collapse fades/builds | No | Temporal post-processing |
| Find a slide shown earlier | No | Global perceptual deduplication |
| Capture export-quality images | No | Seek/recapture at source resolution |
| Produce PPTX/PDF/OCR/notes | No | Document, OCR, and transcription layers |

This boundary matters when comparing "video to PowerPoint" tools: slide-change
detection, original-slide recovery, and generating a new deck from a transcript
are related but different tasks.

## Related resources

- [Awesome Video to Slides](https://github.com/larry-xue/awesome-video-to-slides) - Curated tools and libraries for converting videos, lectures, webinars, and screen recordings into slides, PowerPoint, PDFs, and notes.

## API

### `frameDiff(a, b, width, height, opts?) → { ratio, isNewSlide }`
Compare two RGBA frames of the same size. `ratio` is the fraction of blocks
that changed; `isNewSlide` is `ratio > changedRatio`.

### `createSlideDetector(width, height, opts?) → (frame) => { keep, ratio }`
Stateful. Feed frames in order; `keep === true` means the frame starts a new
slide and becomes the new reference. The first frame is always kept.

### `extractSlideIndices(frames, width, height, opts?) → number[]`
Run the detector over an ordered array of frames; return the indices that
start a new slide.

### Options

| option         | default | meaning                                                |
|----------------|---------|--------------------------------------------------------|
| `blockSize`    | `8`     | px per block edge, at the diff resolution              |
| `blockDelta`   | `14`    | mean \|ΔRGB\| per channel for a block to count changed |
| `changedRatio` | `0.02`  | fraction of changed blocks that flags a new slide      |

The defaults are starting points, not universal accuracy claims. Sampling
interval, codec noise, transitions, animations, camera overlays, and crop area
all affect results. Report the complete configuration when publishing a
benchmark; the [evaluation guide](docs/evaluation.md) provides a shared format.

## What's not in here

This module is deliberately the *simple* core. The full **Video2Any** pipeline
adds the parts that make it robust on real, messy recordings:

- **Auto-threshold calibration** (1-D Otsu) that finds the split between the
  "same slide" noise and the "slide changed" signal per video, instead of a
  fixed `changedRatio`.
- **Activity masking** that excludes a webcam bubble, logo, or animated region
  so a moving talking-head corner doesn't fire on every frame.
- **Transition collapse & global dedup** — a fade caught mid-transition settles
  onto the clean frame, and a presenter jumping back to an earlier slide is
  recognized as a duplicate.
- **Export** to `.pptx`, PDF, image frames, and `.srt` subtitles — all in the
  browser.

If you want the finished product, it's free at **<https://video2any.com>**.

## License

MIT © Video2Any
