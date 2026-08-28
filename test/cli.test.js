import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { OUTRO, grabPoint, shouldShowOutro } from '../cli.js';

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

// The pointer back to the product is the only way a CLI user can ever be
// attributed: running npx is not a page visit, so without a tagged link they
// reach the site with an empty referrer and land in "direct" forever. It still
// has to stay out of the way of anything reading this program's output.
test('the outro carries the tags the site actually reads', () => {
  const url = new URL(OUTRO.slice(OUTRO.indexOf('https://')));
  assert.equal(url.origin, 'https://video2any.com');
  assert.equal(url.searchParams.get('utm_source'), 'cli');
  assert.equal(url.searchParams.get('utm_medium'), 'npm');
});

test('the outro shows after a run that found something', () => {
  assert.equal(shouldShowOutro({ slideCount: 4, quiet: false, ci: false }), true);
});

test('the outro stays quiet when there is nothing to celebrate', () => {
  assert.equal(shouldShowOutro({ slideCount: 0, quiet: false, ci: false }), false);
});

test('--quiet and --json silence the outro', () => {
  assert.equal(shouldShowOutro({ slideCount: 4, quiet: true, ci: false }), false);
});

test('CI silences the outro, because nobody is reading it there', () => {
  assert.equal(shouldShowOutro({ slideCount: 4, quiet: false, ci: true }), false);
});

test('the reported version is the published one, not a copy that drifted', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const reported = execFileSync(process.execPath, [cliPath, '--version'], { encoding: 'utf8' }).trim();
  assert.equal(reported, pkg.version);
});
