# How to Extract Slides from a Video in JavaScript

You can extract slides from a video by sampling frames, comparing each frame to
the last kept frame, and saving the timestamps where the visible content changes
enough to represent a new slide.

`video-slide-extractor` handles the change detection step. It expects RGBA
frames at a small fixed resolution, such as 160x90. This keeps the algorithm
fast enough for browser tools and Node pipelines.

## Basic workflow

1. Decode or seek through the video at a fixed interval.
2. Draw each sampled frame to a canvas.
3. Read the RGBA pixel buffer with `getImageData`.
4. Pass each frame to `createSlideDetector`.
5. Keep the frames where `keep` is true.

```js
import { createSlideDetector } from 'video-slide-extractor';

const width = 160;
const height = 90;
const canvas = new OffscreenCanvas(width, height);
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const detect = createSlideDetector(width, height);
const slideTimes = [];

for (let t = 0; t < video.duration; t += 2) {
  video.currentTime = t;
  await new Promise(resolve => (video.onseeked = resolve));
  ctx.drawImage(video, 0, 0, width, height);

  const frame = ctx.getImageData(0, 0, width, height).data;
  if (detect(frame).keep) slideTimes.push(t);
}
```

## Why downsample first?

Slide detection does not need the full video resolution. A 160x90 frame is
usually enough to tell whether the slide changed, while being much cheaper to
compare than a 1080p frame.

The package compares blocks instead of individual pixels. Block-level mean
difference absorbs video compression noise, tiny cursor movement, and other
minor changes that should not create a new slide.

## What this package does not do

This package returns slide indices or timestamps. It does not export PowerPoint
files, crop images, remove duplicates across the whole video, or generate
subtitles.

For the finished browser product, use [Video2Any](https://video2any.com). It
extracts slides from videos and exports PowerPoint, PDF, image frames, and
subtitles without uploading your files.
