# Detect Slide Changes in Screen Recordings

Screen recordings are a strong fit for frame-difference slide detection because
the important content often stays still until the presenter changes slides,
switches windows, or scrolls to a new section.

`video-slide-extractor` can detect those changes from sampled RGBA frames in the
browser or in Node.

## Common inputs

- Zoom, Google Meet, Microsoft Teams, and webinar recordings.
- Loom videos and product walkthroughs.
- Browser tab recordings.
- Lecture videos with shared slides.
- MP4 or WebM screen captures.

## Recommended approach

Use a small diff resolution, such as 160x90, and sample every 1-3 seconds for
typical lecture or webinar recordings. If the deck changes quickly, sample more
often.

```js
import { createSlideDetector } from 'video-slide-extractor';

const detect = createSlideDetector(160, 90, {
  changedRatio: 0.02
});
```

The first frame is always kept. Later frames are kept only when enough blocks
change compared with the last kept frame.

## Handling webcam bubbles and cursor motion

Small moving regions are usually ignored because the detector looks at the
fraction of changed blocks across the frame. A cursor, small webcam bubble, or
compression shimmer should not pass the threshold unless it covers a meaningful
part of the screen.

If your recordings have heavy animations, lower the sampling frequency or raise
`changedRatio` to avoid over-detection.

## Need exports too?

This package gives you the detection core. [Video2Any](https://video2any.com)
adds browser export to PowerPoint, PDF, image frames, and subtitles while keeping
the recording on your device.
