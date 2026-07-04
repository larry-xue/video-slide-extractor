# video-slide-extractor - Extract Slides from Video with JavaScript

Detect **slide changes, scene cuts, and presentation transitions** in video
frames with JavaScript. Use it to build video-to-PowerPoint, lecture-to-slides,
screen-recording-to-PPT, and browser-based slide extraction tools.

The package is pure functions, **zero dependencies**, and runs in the browser or
in Node. Give it frames, get back the indices where a new slide begins.

This is the open core of **[Video2Any](https://video2any.com)** — a tool that
turns videos, screen recordings, and meeting recordings into editable
PowerPoint decks, PDFs, and subtitles, entirely in your browser (your files
never leave your machine).

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
