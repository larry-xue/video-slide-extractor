# Evaluate a Slide-Change Detector

A useful slide detector should be measured against labeled transitions, not
only demonstrated on a hand-picked clip. This protocol keeps evaluations of
`video-slide-extractor` reproducible and makes threshold changes reviewable.

## 1. Label the source video

Label at the finest granularity the video actually has: one row per visible
frame change, not one row per slide. Type each event as `slide` (a new slide
appears) or `build` (an intra-slide state change: a bullet reveal, an animation
step) and point builds at their parent slide:

```csv
event_id,seconds,type,parent_slide,notes
1,0.0,slide,1,title slide
2,42.4,slide,2,
3,55.0,build,2,second bullet appears
4,63.2,build,2,third bullet appears
5,88.1,slide,3,crossfade transition
```

Do not collapse builds into their parent slide at labeling time. Whether a
build detection counts as a success is a property of the downstream task, not
of the video, so it belongs in the scoring policy (section 3) — encoding it
into the labels forces a relabel whenever the task changes, and hides the
decision from anyone reading your numbers.

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

## 3. Declare the build policy

An incremental bullet build is one slide to a human but N legitimate
visible-frame changes to a difference detector. Whether those N-1 extra
detections are true positives or false positives depends on what the
downstream job wants — the final composed slide, or every intermediate state.
Declare that choice as a scoring parameter, `count_builds`, and report it next
to every metric:

| Policy | Expected transitions | Detections near a `build` event |
| --- | --- | --- |
| `events` | Every labeled row, `slide` and `build` | True positives |
| `collapse-ignore` | `slide` rows only | Discarded before matching (neither TP nor FP) |
| `collapse-strict` | `slide` rows only | False positives |

- `events` fits jobs that want every visible state, such as capturing each
  revealed bullet for OCR.
- `collapse-ignore` fits pipelines where a later temporal-cleanup stage
  discards near-duplicates, so build detections are harmless.
- `collapse-strict` fits jobs that need the detector itself to stay quiet
  during builds, because every build detection becomes a near-duplicate
  someone has to clean up.

Two evaluators can run the same protocol on the same video and honestly report
different recall purely from how they treated builds. With shared
event-granularity labels and a declared policy, that difference is a visible,
reportable flag instead of an accident of labeling.

## 4. Match detections to labels

Derive the expected-transition list from the labels according to the declared
policy. Under `collapse-ignore`, first discard every detection that falls
within the tolerance window of a `build` event. Then give each remaining
detected timestamp a tolerance window, such as two seconds, and match it to at
most one expected transition. Report:

| Metric | Definition |
| --- | --- |
| True positive | A detection matched to an expected transition under the declared policy |
| False positive | An unmatched detection, such as a transition frame — or a build detection under `collapse-strict` |
| False negative | An expected transition with no matched detection |
| Precision | `TP / (TP + FP)` |
| Recall | `TP / (TP + FN)` |
| F1 | Harmonic mean of precision and recall |
| Duplicate rate | Repeated slide images divided by exported slide images |

Also report transition-frame captures separately. A timestamp can be close to
the correct transition while still producing an unusable half-faded image.

## 5. Keep failure classes visible

Tag false positives and false negatives with the cause when possible. Typed
labels make the first tag automatic: any detection near a `build` row is
build-related by construction. Useful causes:

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

## 6. Publish enough evidence to reproduce the result

For every reported benchmark, include the labels, the declared `count_builds`
policy, detector configuration, detected timestamps, metric calculation,
package version, and known blockers.
Raw videos are optional when their license or privacy prevents redistribution.
