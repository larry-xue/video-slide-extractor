# How Video to PowerPoint Conversion Works

Video-to-PowerPoint conversion usually has three parts: detect where slides
change, capture one clean frame for each slide, and place those frames into a
`.pptx` deck.

`video-slide-extractor` focuses on the first part: finding the frames where a
new slide begins.

## The pipeline

1. Sample frames from the video.
2. Downsample each frame to a small diff resolution.
3. Compare every sampled frame with the last kept slide frame.
4. Keep frames that cross the slide-change threshold.
5. Capture higher-resolution images at those timestamps.
6. Write each image to a PowerPoint slide.

## Why frame differencing works for slide decks

A recorded slide deck is mostly still. For several seconds, only compression
noise, cursor movement, or a small webcam bubble changes. When the presenter
advances the deck, a large part of the frame changes at once.

That shape makes slide videos different from normal camera footage. You do not
need object recognition to find most slide transitions. You need a detector that
ignores small noise and reacts to broad visual change.

## Minimal detector usage

```js
import { extractSlideIndices } from 'video-slide-extractor';

const indices = extractSlideIndices(frames, 160, 90, {
  blockSize: 8,
  blockDelta: 14,
  changedRatio: 0.02
});
```

The returned indices tell you which sampled frames start new slides. A complete
converter can then recapture those timestamps at export quality and write them
to `.pptx`.

## Finished browser converter

[Video2Any](https://video2any.com) builds the full product around this idea. It
turns videos, screen recordings, webinars, lectures, and meeting recordings into
editable PowerPoint decks, PDFs, image frames, and subtitles in the browser.
