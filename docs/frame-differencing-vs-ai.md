# Frame Differencing vs AI for Slide Extraction

You usually do not need AI to extract slides from a recorded presentation. For
many lecture, webinar, and screen-recording videos, frame differencing is faster,
cheaper, more private, and easier to debug.

## Frame differencing

Frame differencing compares the current frame with the last kept frame. If
enough visual blocks changed, the current frame is treated as a new slide.

Benefits:

- Runs locally in the browser or Node.
- Requires no model, API key, upload, or GPU.
- Works well when slides are mostly static.
- Easy to tune with visible thresholds.
- Keeps private recordings on the user's machine.

## AI-based extraction

AI can help when the task requires semantic understanding: OCR, layout cleanup,
speaker notes, topic detection, or rebuilding editable text slides. But using AI
just to decide whether a slide changed is often unnecessary overhead.

Costs:

- Upload and privacy concerns.
- API or GPU cost.
- Harder debugging when detections are wrong.
- Extra latency for long videos.

## Practical recommendation

Start with frame differencing for transition detection. Add OCR, speech
transcription, or layout analysis only after you have clean slide frames.

That is the split used by [Video2Any](https://video2any.com): local visual
detection first, richer paid features later where AI actually adds value.
