import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { grabPoint } from '../cli.js';

const cliPath = fileURLToPath(new URL('../cli.js', import.meta.url));

// Detection says "the frame sampled at t starts a new slide", but the change
// happened somewhere in the interval before t. Seeking back to exactly t can
// land on the previous slide's last frame, which is how the CLI once wrote
// slide 2's image into slide-003.png. grabPoint picks a point inside the new
// slide's dwell instead.
const ctx = (fps, duration) => ({ fps, duration });

test('grabs one sample interval past the boundary, not the boundary itself', () => {
  assert.equal(grabPoint(10, 30, ctx(1, 60)), 11);
});

test('never crosses into the next slide when slides are adjacent', () => {
  // Detected at 10 and 11: the midpoint is the furthest safe point.
  assert.equal(grabPoint(10, 11, ctx(1, 60)), 10.5);
});

test('a finer sample rate moves the grab point less', () => {
  assert.equal(grabPoint(10, 30, ctx(4, 60)), 10.25);
});

test('the last slide grabs inside the remaining footage', () => {
  assert.equal(grabPoint(50, NaN, ctx(1, 60)), 51);
});

test('the last slide never seeks past the end of the video', () => {
  assert.equal(grabPoint(59.9, NaN, ctx(1, 60)), 59.95);
});

test('a slide detected at the final frame stays put rather than seeking past it', () => {
  assert.equal(grabPoint(60, NaN, ctx(1, 60)), 60);
});

test('the grab point is never before the detected start', () => {
  for (const [seconds, next, fps, duration] of [[0, 5, 1, 20], [5, 5.2, 2, 20], [19, NaN, 1, 19]]) {
    assert.ok(grabPoint(seconds, next, ctx(fps, duration)) >= seconds,
      `grab point moved backwards for ${seconds}`);
  }
});

test('importing the CLI does not run it', () => {
  // The assertions above already prove it: a CLI run with no argv would have
  // exited the process before this file finished loading.
  assert.equal(typeof grabPoint, 'function');
});

test('runs when invoked through a symlink, the way npm installs the bin', () => {
  // npm links the bin into node_modules/.bin, so argv[1] is the link and
  // import.meta.url is its target. An entry-point check that compares them
  // unresolved makes `npx video-slide-extractor video.mp4` print nothing and
  // exit 0, which is worse than crashing.
  const link = path.join(mkdtempSync(path.join(tmpdir(), 'vse-bin-')), 'video-slide-extractor');
  symlinkSync(cliPath, link);
  const out = execFileSync(process.execPath, [link, '--version'], { encoding: 'utf8' });
  assert.equal(out.trim(), execFileSync(process.execPath, [cliPath, '--version'], { encoding: 'utf8' }).trim());
  assert.match(out.trim(), /^\d+\.\d+\.\d+$/);
});
