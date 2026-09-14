import assert from 'node:assert/strict';
import test from 'node:test';
import E from '../src/engine.js';
import { RENDER_DEFAULTS, RENDER_RANGES, readRenderSettings } from '../src/render-settings.js';

const points = [{ x: .95, y: 0 }, { x: .65, y: .3 }, { x: .3, y: .65 }, { x: 0, y: .95 }];
const settings = { color: '#90b0d0', mode: 'Through anchors', blend: 'Smooth', falloff: 1, dither: 'Off' };

// Minimal pixel sink for testing the actual renderer without native canvas dependencies.
function canvas(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  return {
    pixels,
    fillRect() { for (let i = 0; i < pixels.length; i += 4) pixels.set([0, 0, 0, 255], i); },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(image, x, y) {
      for (let row = 0; row < image.height; row++) {
        pixels.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), ((y + row) * width + x) * 4);
      }
    },
  };
}
function render(overrides, width = 257, height = 257) {
  const ctx = canvas(width, height);
  E.render(ctx, width, height, E.prepare(points, { ...settings, ...overrides }));
  return ctx.pixels;
}

test('legacy setups retain smooth output; rendering parameters are validated', () => {
  assert.deepEqual(render({}), render(RENDER_DEFAULTS));
  assert.deepEqual(readRenderSettings({}), RENDER_DEFAULTS);
  assert.equal(readRenderSettings({ renderStyle: 'Ordered dither' }).orderedSizeFade, 0);
  assert.deepEqual(render({ renderStyle: 'Ordered dither' }), render({ renderStyle: 'Ordered dither', orderedSizeFade: 0 }));
  assert.throws(() => readRenderSettings({ renderStyle: 'Unknown' }));
  for (const [key, [min, max]] of Object.entries(RENDER_RANGES)) {
    for (const value of [null, '2', NaN, Infinity, min - 1, max + 1]) {
      assert.throws(() => readRenderSettings({ [key]: value }), key);
    }
  }
  assert.deepEqual(readRenderSettings({ renderStyle: 'Mesh', meshLayers: 2 }), RENDER_DEFAULTS);
  assert.deepEqual(render({ renderStyle: 'Mesh' }), render({ renderStyle: 'Smooth' }));
  assert.throws(() => readRenderSettings({ orderedLevels: 4.5 }));
});

test('Ordered dither: bounded color, exact black outside, exact corner, and chunked export parity', async () => {
  const renderStyle = 'Ordered dither', width = 257, height = 129;
  const image = render({ renderStyle, orderedSizeFade: 100 }, width, height);
  let lit = 0, dark = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = image.subarray((y * width + x) * 4, (y * width + x) * 4 + 4);
    assert.equal(pixel[3], 255);
    for (let c = 0; c < 3; c++) assert(pixel[c] <= [144, 176, 208][c]);
    if ((width - 1 - x) / (width - 1) + (height - 1 - y) / (height - 1) >= .95 + 1e-6) {
      assert.deepEqual(Array.from(pixel), [0, 0, 0, 255]);
    }
    if (pixel[0]) lit++; else dark++;
  }
  assert(lit > 100 && dark > 100);
  assert.deepEqual(Array.from(image.slice(-4)), [144, 176, 208, 255]);
  const ctx = canvas(width, height), s = { ...settings, renderStyle, orderedSizeFade: 100 };
  const prepared = E.prepare(points, s);
  s.orderedSpacing = 6; s.orderedSizeFade = 0; s.color = '#ff0000';
  await E.renderAsync(ctx, width, height, prepared);
  assert.deepEqual(ctx.pixels, image, 'Export must use the frozen settings and the same pattern across chunks');
  assert.notDeepEqual(image, render({}, width, height));
});

test('every ordered-dither parameter changes the rendered result', () => {
  const variants = { orderedSpacing: 3, orderedDotSize: 35, orderedSizeFade: 100, orderedLevels: 2, orderedContrast: 2 };
  const renderStyle = 'Ordered dither', base = render({ renderStyle });
  for (const [key, value] of Object.entries(variants)) {
    assert.notDeepEqual(render({ renderStyle, [key]: value }), base, key);
  }
});

test('pattern positions and tones stay aligned across preview and export resolutions', () => {
  const renderStyle = 'Ordered dither';
  const low = render({ renderStyle, orderedSizeFade: 100 }, 257, 257);
  const high = render({ renderStyle, orderedSizeFade: 100 }, 513, 513);
  // Use broad features to avoid comparing different antialiasing footprints at edges.
  const a = render({ renderStyle, orderedDotSize: 100 }, 257, 257);
  const b = render({ renderStyle, orderedDotSize: 100 }, 513, 513);
  for (let y = 0; y < 257; y++) for (let x = 0; x < 257; x++) {
    assert(Math.abs(a[(y * 257 + x) * 4] - b[(y * 2 * 513 + x * 2) * 4]) <= 1);
  }
  // Sampling an exported pattern should approximate the preview (edge AA differs).
  let error = 0;
  for (let y = 0; y < 257; y++) for (let x = 0; x < 257; x++) {
    error += Math.abs(low[(y * 257 + x) * 4] - high[(y * 2 * 513 + x * 2) * 4]);
  }
  assert(error / (257 * 257) < 12);
});

test('size fade reduces square widths toward darkness without moving the dot centers', () => {
  const width = 801, height = 801;
  const options = { renderStyle: 'Ordered dither', orderedSpacing: 5, orderedDotSize: 65, orderedLevels: 16 };
  const fixed = render(options, width, height);
  const partial = render({ ...options, orderedSizeFade: 50 }, width, height);
  const shrinking = render({ ...options, orderedSizeFade: 100 }, width, height);
  // All samples are at cell centers, on the same row, from bright to dark.
  const centers = [720, 480, 240], row = 760;
  function dotWidth(pixels, center) {
    const lit = [];
    for (let dx = -19; dx <= 19; dx++) {
      if (pixels[(row * width + center + dx) * 4] > 0) lit.push(dx);
    }
    assert(lit.includes(0));
    assert.equal(lit[0], -lit.at(-1), 'Each square remains centered on its original grid point');
    return lit.length;
  }
  const fixedWidths = centers.map(x => dotWidth(fixed, x));
  const fadedWidths = centers.map(x => dotWidth(shrinking, x));
  assert.equal(fixedWidths[0], fixedWidths[1]);
  assert.equal(fixedWidths[1], fixedWidths[2]);
  assert(fadedWidths[0] > fadedWidths[1] && fadedWidths[1] > fadedWidths[2]);
  for (const [i, x] of centers.entries()) {
    const between = dotWidth(partial, x);
    assert(fadedWidths[i] <= between && between <= fixedWidths[i]);
    assert.equal(shrinking[(row * width + x) * 4], fixed[(row * width + x) * 4], 'Tone at the dot center is unchanged');
  }
});
