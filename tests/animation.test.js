import assert from 'node:assert/strict';
import test from 'node:test';
import E from '../src/engine.js';
import { EXPORT_DEFAULTS, animationPlan, readExportSettings } from '../src/export-settings.js';
import { createAnimationEncoder } from '../src/animation-encoders.js';
import { decodeGIF, decodeAPNG } from './helpers/animation-decode.js';
import { animationCrop } from '../src/animation-crop.js';
import { LOGO_DEFAULTS, logoBox, readLogoSettings } from '../src/logo.js';

const base = [{ x: .8, y: 0 }, { x: .6, y: .15 }, { x: .2, y: .5 }, { x: 0, y: .85 }];
const wave = { waveEnabled: true, waveSpeed: .12, waveAmplitude: 25, waveLength: 1.4, waveComplexity: .8, waveEdges: .5 };
const near = (a, b, tolerance = 1e-7) => assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('logo settings validate old setups and preserve square bounds across canvas ratios', () => {
  assert.deepEqual(readLogoSettings({}), LOGO_DEFAULTS);
  for (const bad of [{ logoEnabled: 'true' }, { logoX: -1 }, { logoY: Infinity }, { logoSize: 0 }, { logoSize: 81 }]) {
    assert.throws(() => readLogoSettings(bad));
  }
  for (const [width, height] of [[3840, 2160], [2160, 3840], [64, 4096], [4096, 64]]) {
    for (const logoX of [0, .5, 1]) for (const logoY of [0, .5, 1]) {
      const box = logoBox(width, height, { ...LOGO_DEFAULTS, logoX, logoY, logoSize: 80 });
      near(box.size, Math.min(width, height) * .8);
      assert(box.x >= 0 && box.y >= 0 && box.x + box.size <= width && box.y + box.size <= height);
    }
  }
});

test('loop positions and velocities join smoothly, with moving, ordered anchors', () => {
  for (const seconds of [1, 6, 13, 20]) for (const speed of [.01, .12, .75, 1]) {
    const settings = { ...wave, waveSpeed: speed }, phase = 4.13, epsilon = 1e-6;
    const at = t => E.loopPoints(base, settings, t, seconds, phase);
    assert.deepEqual(at(0), E.wavePoints(base, settings, phase));
    assert.deepEqual(at(0), at(1));
    assert.notDeepEqual(at(0), at(.137));
    for (let i = 0; i < 4; i++) for (const key of ['x', 'y']) {
      near((at(0)[i][key] - at(-epsilon)[i][key]) / epsilon,
        (at(epsilon)[i][key] - at(0)[i][key]) / epsilon, .02);
    }
    for (let i = 0; i < 60; i++) {
      const points = at(i / 60);
      assert.equal(points[0].y, 0); assert.equal(points[3].x, 0);
      for (let j = 1; j < 4; j++) assert(points[j].x < points[j - 1].x && points[j].y > points[j - 1].y);
      for (const p of points) assert(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
    }
  }
});

test('paused or disabled wave motion remains static in exported loops', () => {
  for (const override of [{ waveEnabled: false }, { waveSpeed: 0 }, { waveAmplitude: 0 }]) {
    const settings = { ...wave, ...override };
    for (const t of [0, .2, .9, 1]) assert.deepEqual(E.loopPoints(base, settings, t, 6, 3), E.wavePoints(base, settings, 3));
  }
});

test('animation crop covers the entire loop, including moving edges and frozen poses', () => {
  const points = base.map(p => ({ x: p.x * .5, y: p.y * .5 }));
  const plan = { width: 320, height: 180, frames: 60, seconds: 6 };
  for (const override of [{}, { waveEnabled: false }, { waveSpeed: 0 }, { waveEdges: 0 }]) {
    const settings = { ...wave, waveAmplitude: 35, waveEdges: 1, ...override };
    const crop = animationCrop(plan, points, settings, 2.4);
    assert(crop.x > 0 && crop.y > 0);
    assert.equal(crop.x + crop.width, plan.width);
    assert.equal(crop.y + crop.height, plan.height);
    let minX = plan.width, minY = plan.height;
    for (let frame = 0; frame < plan.frames; frame++) {
      const pose = E.loopPoints(points, settings, frame / plan.frames, plan.seconds, 2.4);
      const x = Math.floor((1 - pose[0].x) * (plan.width - 1));
      const y = Math.floor((1 - pose[3].y) * (plan.height - 1));
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      assert(crop.x <= x && crop.y <= y, 'Every frame must fit inside the same crop');
      for (const mode of ['Through anchors', 'Cubic handles']) {
        for (const curve of E.segments(pose, mode)) for (let i = 0; i <= 20; i++) {
          const p = E.evaluate(curve, i / 20);
          assert((1 - p.x) * (plan.width - 1) >= crop.x - 1e-10);
          assert((1 - p.y) * (plan.height - 1) >= crop.y - 1e-10);
        }
      }
    }
    assert.equal(crop.x, minX); assert.equal(crop.y, minY);
  }
  const full = [{ x: 1, y: 0 }, { x: .7, y: .2 }, { x: .2, y: .7 }, { x: 0, y: 1 }];
  assert.deepEqual(animationCrop(plan, full, wave, 0), { x: 0, y: 0, width: 320, height: 180 });
  const tiny = points.map(p => ({ x: p.x / 10000, y: p.y / 10000 }));
  assert.deepEqual(animationCrop(plan, tiny, wave, 0), { x: 318, y: 178, width: 2, height: 2 });
});

test('export settings support old setups and limit animation work before allocation', () => {
  assert.deepEqual(readExportSettings({}), EXPORT_DEFAULTS);
  const settings = { ...EXPORT_DEFAULTS, exportFormat: 'GIF', width: 3840, height: 2160, loopDuration: 1, loopFPS: 10 };
  assert.deepEqual(animationPlan(settings), { format: 'GIF', width: 3840, height: 2160, frames: 10, fps: 10, seconds: 1 });
  for (const [width, height] of [[1920, 1080], [2048, 2048], [2160, 3840], [128, 72]]) {
    const plan = animationPlan({ ...settings, width, height, loopMaxEdge: 128 });
    assert.equal(plan.width, width); assert.equal(plan.height, height);
  }
  for (const bad of [{ exportFormat: 'WEBM' }, { loopDuration: 0 }, { loopDuration: 1.5 }, { loopFPS: 0 },
    { exportCropped: null }, { exportCropped: 'true' }]) assert.throws(() => readExportSettings(bad));
  assert.throws(() => animationPlan({ ...settings, loopDuration: 20, loopFPS: 30 }), /too large/);
});

for (const format of ['GIF', 'APNG']) {
  test(`${format} frames decode correctly, loop forever, and retain timing`, () => {
    const width = 17, height = 9, frames = 24, fps = 24, rgb = [128, 176, 208];
    const encoder = createAnimationEncoder({ format, width, height, frames, fps }, rgb);
    const inputs = [];
    for (let frame = 0; frame < frames; frame++) {
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const t = i === 0 ? 0 : i === width * height - 1 ? 1 : ((i + frame * 7) % 256) / 255;
        rgba.set([...rgb.map(c => Math.round(c * t)), 255], i * 4);
      }
      encoder.addFrame(rgba); inputs.push(rgba);
    }
    const bytes = encoder.finish();
    const decoded = format === 'GIF' ? decodeGIF(bytes) : decodeAPNG(bytes);
    assert.equal(decoded.width, width); assert.equal(decoded.height, height);
    assert.equal(decoded.frames.length, frames); assert.equal(decoded.plays, 0);
    near(decoded.frames.reduce((sum, f) => sum + f.delay, 0), frames / fps);
    for (const [i, f] of decoded.frames.entries()) {
      assert.deepEqual([...f.rgba.slice(0, 4)], [0, 0, 0, 255]);
      assert.deepEqual([...f.rgba.slice(-4)], [...rgb, 255]);
      if (format === 'APNG') assert.deepEqual(f.rgba, inputs[i]);
      else for (let j = 0; j < f.rgba.length; j++) assert(Math.abs(f.rgba[j] - inputs[i][j]) <= 1);
    }
    const incomplete = createAnimationEncoder({ format, width, height, frames, fps }, rgb);
    assert.throws(() => incomplete.finish(), /missing frames/);
  });
}
