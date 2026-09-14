import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { decodeGIF, decodeAPNG } from './helpers/animation-decode.js';

const state = page => page.evaluate(() => CornerStudio.getState());
const control = (page, key) => page.locator(`[data-control="${key}"] input`).last();
const same = (a, b, tolerance = 1e-6) => assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);
async function setNumber(page, key, value) {
  const input = control(page, key);
  await input.fill(String(value));
  await input.press('Tab');
}
async function disableWave(page) {
  await control(page, 'waveEnabled').uncheck();
  await expect.poll(async () => (await state(page)).settings.waveEnabled).toBe(false);
  await page.evaluate(() => new Promise(requestAnimationFrame));
}
async function center(page, index) {
  const b = await page.locator(`.anchor[data-index="${index}"] .anchor-ring`).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function drag(page, index, dx, dy) {
  const p = await center(page, index);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => new Promise(requestAnimationFrame));
}
async function captureBlobs(page) {
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = blob => {
      window.__lastBlob = blob;
      return original.call(URL, blob);
    };
  });
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') {
      externalRequests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  page.__errors = errors;
  page.__externalRequests = externalRequests;
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.CornerStudio));
  await expect(page.locator('#gui-host .dg.main')).toBeVisible();
  await expect(page.locator('#library-badge')).toHaveText('dat.gui');
});

test.afterEach(async ({ page }) => {
  expect(page.__errors).toEqual([]);
  expect(page.__externalRequests).toEqual([]);
});

test('wave playback, freezing, inverse dragging, and exact frozen PNG export', async ({ page }) => {
  const before = await state(page);
  const path = await page.locator('#curve-line').getAttribute('d');
  const pixels = await page.locator('#gradient').evaluate(c => c.toDataURL());
  await expect.poll(() => page.locator('#curve-line').getAttribute('d')).not.toBe(path);
  await expect.poll(() => page.locator('#gradient').evaluate(c => c.toDataURL())).not.toBe(pixels);
  expect(await state(page)).toEqual(before);
  await setNumber(page, 'waveSpeed', 0);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const frozen = await page.locator('#curve-line').getAttribute('d');
  await page.waitForTimeout(150);
  expect(await page.locator('#curve-line').getAttribute('d')).toBe(frozen);
  const p = await center(page, 1);
  await drag(page, 1, -12, -8);
  const moved = await center(page, 1);
  same(moved.x, p.x - 12, .1);
  same(moved.y, p.y - 8, .1);

  await captureBlobs(page);
  await page.evaluate(() => {
    const s = CornerStudio.getState();
    Object.assign(s.settings, { width: 96, height: 64, waveSpeed: .27 });
    CornerStudio.setState(s);
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => {
    const s = CornerStudio.getState().settings;
    const c = document.createElement('canvas');
    c.width = s.width; c.height = s.height;
    CornerEngine.render(c.getContext('2d'), c.width, c.height,
      CornerEngine.prepare(CornerStudio.getAnimatedPoints(), s));
    window.__expectedPixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    document.querySelector('#export').click();
    const changed = CornerStudio.getState();
    changed.settings.color = '#ff0000';
    CornerStudio.setState(changed);
  });
  await page.waitForFunction(() => window.__lastBlob?.type === 'image/png' && !document.querySelector('#export').disabled);
  expect(await page.evaluate(async () => {
    const bitmap = await createImageBitmap(window.__lastBlob);
    const c = document.createElement('canvas');
    c.width = bitmap.width; c.height = bitmap.height;
    c.getContext('2d').drawImage(bitmap, 0, 0);
    const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return pixels.length === window.__expectedPixels.length && pixels.every((v, i) => v === window.__expectedPixels[i]);
  })).toBe(true);
});

test('anchor constraints, undo/redo, scaling, curve modes, presets, and keyboard editing', async ({ page }) => {
  await disableWave(page);
  const board = await page.locator('#gradient').boundingBox();
  await drag(page, 0, -85, -90);
  let points = (await state(page)).points;
  same(points[0].y, 0); same(points[0].x, .4 + 85 / board.width);
  same(points[3].x, 0); same(points[3].y, .4);
  await drag(page, 3, -70, -60);
  points = (await state(page)).points;
  same(points[3].x, 0); same(points[3].y, .4 + 60 / board.height);
  for (const index of [1, 2]) {
    const before = (await state(page)).points[index];
    await drag(page, index, -15, -10);
    const after = (await state(page)).points[index];
    same(after.x, before.x + 15 / board.width);
    same(after.y, before.y + 10 / board.height);
  }
  const changed = await state(page);
  await page.locator('#undo').click();
  expect(await state(page)).not.toEqual(changed);
  await page.locator('#redo').click();
  expect(await state(page)).toEqual(changed);
  await page.locator('#reset').click();
  await disableWave(page);
  const original = (await state(page)).points;
  await setNumber(page, 'size', 80);
  (await state(page)).points.forEach((p, i) => {
    same(p.x, original[i].x * 2); same(p.y, original[i].y * 2);
  });
  const mode = page.locator('[data-control="mode"] select');
  await mode.selectOption('Cubic handles');
  await expect(page.locator('#control-polygon')).toBeVisible();
  await expect.poll(async () => (await page.locator('#curve-line').getAttribute('d')).split(' C').length).toBe(2);
  await mode.selectOption('Through anchors');
  await expect.poll(async () => (await page.locator('#curve-line').getAttribute('d')).split(' C').length).toBe(4);
  await page.locator('#preview-view').click();
  await expect(page.locator('#overlay')).not.toBeVisible();
  await page.locator('#edit-view').click();
  await expect(page.locator('#overlay')).toBeVisible();
  await page.locator('#artboard').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('#anchors')).not.toBeVisible();
  await page.locator('#curve-hit').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#anchors')).toBeVisible();
  await page.locator('.anchor[data-index="1"]').focus();
  const beforeNudge = (await state(page)).points[1].x;
  await page.keyboard.press('ArrowLeft');
  expect((await state(page)).points[1].x).toBeGreaterThan(beforeNudge);
  for (const preset of ['Sketch', 'Round', 'Wide', 'Tall', 'Diagonal']) {
    await page.locator('[data-control="preset"] select').selectOption(preset);
    const p = (await state(page)).points;
    for (let i = 0; i < 3; i++) expect(p[i].x > p[i + 1].x && p[i].y < p[i + 1].y).toBe(true);
  }
});

test('4K PNG has exact colors and no guides; JSON save/load, validation, and persistence', async ({ page }) => {
  await disableWave(page);
  await captureBlobs(page);
  const color = control(page, 'color');
  await color.fill('#7088a0');
  await color.press('Tab');
  expect((await state(page)).settings.color).toBe('#7088a0');
  await page.locator('#export').click();
  await page.waitForFunction(() => window.__lastBlob?.type === 'image/png' && !document.querySelector('#export').disabled);
  const sample = await page.evaluate(async () => {
    const bitmap = await createImageBitmap(window.__lastBlob);
    const c = document.createElement('canvas');
    c.width = bitmap.width; c.height = bitmap.height;
    const ctx = c.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
    return { width: c.width, height: c.height,
      pixels: [[0, 0], [3839, 2159], [1920, 1080], [3839, 0], [0, 2159], [2304, 2159]]
        .map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data)) };
  });
  expect(sample).toEqual({ width: 3840, height: 2160, pixels:
    [[0, 0, 0, 255], [112, 136, 160, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]] });
  const saved = await state(page);
  await page.locator('#save-setup').click();
  await page.waitForFunction(() => window.__lastBlob?.type === 'application/json');
  const setup = await page.evaluate(() => window.__lastBlob.text());
  expect(JSON.parse(setup)).toEqual(saved);
  await page.locator('#reset').click();
  await page.locator('#setup-file').setInputFiles({ name: 'setup.json', mimeType: 'application/json', buffer: Buffer.from(setup) });
  await expect.poll(() => state(page)).toEqual(saved);
  const invalid = structuredClone(saved); invalid.points[0].y = .3;
  await page.locator('#setup-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.locator('#toast')).toContainText('endpoints');
  expect(await state(page)).toEqual(saved);
  const badWave = structuredClone(saved); badWave.settings.waveLength = 0;
  expect(await page.evaluate(s => { try { CornerStudio.setState(s); return false; } catch { return true; } }, badWave)).toBe(true);
  expect(await state(page)).toEqual(saved);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('corner-gradient-studio.v1')))).toEqual(saved);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.CornerStudio));
  expect(await state(page)).toEqual(saved);
  const legacy = structuredClone(saved);
  for (const key of Object.keys(legacy.settings)) if (key.startsWith('wave')) delete legacy.settings[key];
  await page.evaluate(s => CornerStudio.setState(s), legacy);
  expect((await state(page)).settings.waveEnabled).toBe(false);
});

test('desktop layout fits without horizontal overflow', async ({ page }, testInfo) => {
  const finish = page.getByRole('button', { name: /Finish/ });
  await expect(page.locator('[data-control="blend"]')).not.toBeVisible();
  await finish.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-control="blend"]')).toBeVisible();
  await finish.click();
  await expect(page.locator('[data-control="blend"]')).not.toBeVisible();
  for (const [width, height] of [[1440, 900], [1024, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => {
      const b = await page.locator('#gradient').boundingBox();
      return b.y + b.height < height - 25;
    }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('desktop.png') });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  test('touch dragging preserves edge constraints', async ({ page, context }, testInfo) => {
    await disableWave(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator('#gradient').boundingBox()).width).toBeLessThan(390);
    await expect(page.locator('[data-control="color"]')).toBeVisible();
    await page.locator('.anchor[data-index="3"]').scrollIntoViewIfNeeded();
    const { x, y } = await center(page, 3);
    const before = (await state(page)).points[3].y;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 15, y: y - 30 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = (await state(page)).points[3];
    expect(after.y).toBeGreaterThan(before); same(after.x, 0);
    await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  });
});

test('Ordered dither controls, history, setup persistence, and frozen PNG export', async ({ page }, testInfo) => {
  await disableWave(page);
  const styleSelect = page.locator('[data-control="renderStyle"] select');
  expect(await styleSelect.locator('option').allTextContents()).toEqual(['Smooth', 'Ordered dither']);
  await styleSelect.selectOption('Ordered dither');
  const parameters = { orderedSpacing: 2.5, orderedDotSize: 75, orderedLevels: 6, orderedContrast: .8, orderedSizeFade: 100 };
  for (const [key, value] of Object.entries(parameters)) {
    await expect(control(page, key)).toBeVisible();
    await setNumber(page, key, value);
    expect((await state(page)).settings[key]).toBe(value);
  }
  const configured = await state(page);
  await page.locator('#undo').click();
  expect(await state(page)).not.toEqual(configured);
  await page.locator('#redo').click();
  expect(await state(page)).toEqual(configured);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('corner-gradient-studio.v1')))).toEqual(configured);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.CornerStudio));
  expect(await state(page)).toEqual(configured);
  await captureBlobs(page);
  await page.locator('#save-setup').click();
  const setup = await page.evaluate(() => window.__lastBlob.text());
  expect(JSON.parse(setup)).toEqual(configured);
  await page.locator('#reset').click();
  await page.locator('#setup-file').setInputFiles({ name: 'pattern.json', mimeType: 'application/json', buffer: Buffer.from(setup) });
  await expect.poll(() => state(page)).toEqual(configured);
  const invalid = structuredClone(configured);
  invalid.settings[Object.keys(parameters)[0]] = 0;
  expect(await page.evaluate(s => { try { CornerStudio.setState(s); return false; } catch { return true; } }, invalid)).toBe(true);
  expect(await state(page)).toEqual(configured);

  // A larger, brighter contour makes the texture easy to inspect visually.
  await page.evaluate(() => {
    const s = CornerStudio.getState();
    Object.assign(s.settings, { color: '#c8c8c8', width: 768, height: 768, preset: 'Custom' });
    s.points = [{ x: .98, y: 0 }, { x: .85, y: .4 }, { x: .4, y: .85 }, { x: 0, y: .98 }];
    CornerStudio.setState(s);
  });
  await page.locator('#preview-view').click();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.locator('.inspector').evaluate(el => { el.scrollTop = 0; });
  await page.locator('#gradient').screenshot({ path: testInfo.outputPath('pattern.png') });
  await page.screenshot({ path: testInfo.outputPath('editor.png') });
  await page.evaluate(() => {
    const s = CornerStudio.getState();
    // Freeze an animated pose at the full 4K export size.
    Object.assign(s.settings, { width: 3840, height: 2160, waveEnabled: true });
    CornerStudio.setState(s);
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => {
    const s = CornerStudio.getState().settings;
    const c = document.createElement('canvas'); c.width = s.width; c.height = s.height;
    CornerEngine.render(c.getContext('2d'), c.width, c.height, CornerEngine.prepare(CornerStudio.getAnimatedPoints(), s));
    window.__expectedPixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    window.__lastBlob = null;
    document.querySelector('#export').click();
    const changed = CornerStudio.getState();
    changed.settings.renderStyle = 'Smooth'; changed.settings.color = '#ff0000';
    CornerStudio.setState(changed);
  });
  await page.waitForFunction(() => window.__lastBlob?.type === 'image/png' && !document.querySelector('#export').disabled);
  expect(await page.evaluate(async () => {
    const bitmap = await createImageBitmap(window.__lastBlob), c = document.createElement('canvas');
    c.width = bitmap.width; c.height = bitmap.height;
    c.getContext('2d').drawImage(bitmap, 0, 0);
    const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return bitmap.width === 3840 && bitmap.height === 2160 && pixels.every((v, i) => v === window.__expectedPixels[i]);
  })).toBe(true);

  // Existing ordered-dither setups retain their fixed-size squares.
  const fixedSizeSetup = structuredClone(configured);
  delete fixedSizeSetup.settings.orderedSizeFade;
  await page.evaluate(s => CornerStudio.setState(s), fixedSizeSetup);
  expect((await state(page)).settings.renderStyle).toBe('Ordered dither');
  expect((await state(page)).settings.orderedSizeFade).toBe(0);

  // A pre-pattern setup must still load with its original rendering style.
  const legacy = structuredClone(configured);
  for (const key of Object.keys(legacy.settings)) {
    if (key === 'renderStyle' || key.startsWith('ordered')) delete legacy.settings[key];
  }
  await page.evaluate(s => CornerStudio.setState(s), legacy);
  expect((await state(page)).settings.renderStyle).toBe('Smooth');
  await expect(page.locator('[data-control="orderedSpacing"]')).not.toBeVisible();
});

for (const format of ['GIF', 'APNG']) {
  test(`${format} exports a real repeating animation from frozen settings`, async ({ page }, testInfo) => {
    await page.evaluate(format => {
      const s = CornerStudio.getState();
      Object.assign(s.settings, { color: '#7088a0', waveEnabled: true, waveSpeed: .5, waveAmplitude: 25,
        renderStyle: format === 'APNG' ? 'Ordered dither' : 'Smooth', orderedSizeFade: 100 });
      CornerStudio.setState(s);
    }, format);
    await page.getByRole('button', { name: /Canvas & export/ }).click();
    await page.locator('[data-control="exportFormat"] select').selectOption(format);
    await setNumber(page, 'loopDuration', 2);
    await setNumber(page, 'loopMaxEdge', 128);
    await page.locator('[data-control="loopFPS"] select').selectOption('10');
    await expect(page.locator('#export-label')).toHaveText(`Export ${format}`);
    await expect(page.locator('#export-note')).toContainText('128 × 72 before cropping · 20 frames');
    await page.screenshot({ path: testInfo.outputPath('animation-controls.png'), fullPage: true });
    const saved = await state(page);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('corner-gradient-studio.v1')))).toEqual(saved);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.CornerStudio));
    expect(await state(page)).toEqual(saved);
    await captureBlobs(page);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const expected = await page.evaluate(() => {
      const s = CornerStudio.getState().settings, c = document.createElement('canvas');
      c.width = 128; c.height = 72;
      CornerEngine.render(c.getContext('2d'), c.width, c.height, CornerEngine.prepare(CornerStudio.getAnimatedPoints(), s));
      const expected = Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
      document.querySelector('#export').click();
      const changed = CornerStudio.getState(); changed.settings.color = '#ff0000'; changed.settings.waveAmplitude = 0;
      CornerStudio.setState(changed);
      return expected;
    });
    await page.waitForFunction(() => window.__lastBlob && !document.querySelector('#export').disabled);
    expect(await page.evaluate(() => window.__lastBlob.type)).toBe(format === 'GIF' ? 'image/gif' : 'image/apng');
    await expect(page.locator('#cancel-export')).not.toBeVisible();
    const base64 = await page.evaluate(() => new Promise(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(window.__lastBlob);
    }));
    const bytes = Buffer.from(base64, 'base64');
    await writeFile(testInfo.outputPath(`loop.${format.toLowerCase()}`), bytes);
    const decoded = format === 'GIF' ? decodeGIF(bytes) : decodeAPNG(bytes);
    expect([decoded.frames.length, decoded.plays]).toEqual([20, 0]);
    expect(decoded.width).toBeLessThan(128);
    expect(decoded.height).toBeLessThan(72);
    const cropX = 128 - decoded.width, cropY = 72 - decoded.height, expectedCrop = [];
    for (let y = 0; y < 72; y++) for (let x = 0; x < 128; x++) {
      const pixel = expected.slice((y * 128 + x) * 4, (y * 128 + x + 1) * 4);
      if (x >= cropX && y >= cropY) expectedCrop.push(...pixel);
      else assert.deepEqual(pixel, [0, 0, 0, 255], 'The crop must only remove unused black canvas');
    }
    await expect(page.locator('#toast')).toContainText(`${decoded.width} × ${decoded.height}`);
    same(decoded.frames.reduce((sum, f) => sum + f.delay, 0), 2);
    const first = decoded.frames[0].rgba;
    if (format === 'APNG') expect(Array.from(first)).toEqual(expectedCrop);
    else first.forEach((v, i) => assert(Math.abs(v - expectedCrop[i]) <= 1));
    expect(decoded.frames[10].rgba).not.toEqual(first);
    expect(decoded.frames.at(-1).rgba).not.toEqual(first);
    const distance = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0);
    const differences = decoded.frames.slice(1).map((f, i) => distance(f.rgba, decoded.frames[i].rgba));
    expect(distance(first, decoded.frames.at(-1).rgba)).toBeLessThanOrEqual(Math.max(...differences) * 1.25);
    for (const frame of decoded.frames) {
      expect(Array.from(frame.rgba.slice(0, 4))).toEqual([0, 0, 0, 255]);
      expect(Array.from(frame.rgba.slice(-4))).toEqual([112, 136, 160, 255]);
    }
    // Confirm the browser can also load the exported image.
    expect(await page.evaluate(async () => {
      const img = new Image(), url = URL.createObjectURL(window.__lastBlob);
      try { img.src = url; await img.decode(); return [img.naturalWidth, img.naturalHeight]; }
      finally { URL.revokeObjectURL(url); }
    })).toEqual([decoded.width, decoded.height]);
    const legacy = structuredClone(saved);
    for (const key of ['exportFormat', 'loopDuration', 'loopFPS', 'loopMaxEdge']) delete legacy.settings[key];
    await page.evaluate(s => CornerStudio.setState(s), legacy);
    expect((await state(page)).settings.exportFormat).toBe('PNG');
    await expect(page.locator('#export-label')).toHaveText('Export PNG');
  });
}

test('animated export can be cancelled and rejects oversized jobs without blocking the editor', async ({ page }) => {
  await captureBlobs(page);
  await page.evaluate(() => {
    const s = CornerStudio.getState(); Object.assign(s.settings, { exportFormat: 'GIF', loopMaxEdge: 1280 });
    CornerStudio.setState(s);
    document.querySelector('#export').click();
    document.querySelector('#cancel-export').click();
  });
  await expect(page.locator('#toast')).toHaveText('Export cancelled.');
  await expect(page.locator('#export')).toBeEnabled();
  await expect(page.locator('#cancel-export')).not.toBeVisible();
  await expect(page.locator('#reset')).toBeVisible();
  expect(await page.evaluate(() => Boolean(window.__lastBlob))).toBe(false);
  await page.evaluate(() => {
    const s = CornerStudio.getState(); Object.assign(s.settings, { loopMaxEdge: 1920, loopDuration: 20, loopFPS: 30 });
    CornerStudio.setState(s); document.querySelector('#export').click();
  });
  await expect(page.locator('#toast')).toContainText('too large');
  await expect(page.locator('#export')).toBeEnabled();
  await page.evaluate(() => {
    const s = CornerStudio.getState(); Object.assign(s.settings, { loopMaxEdge: 128, loopDuration: 1, loopFPS: 10 });
    CornerStudio.setState(s); document.querySelector('#export').click();
  });
  await page.waitForFunction(() => window.__lastBlob?.type === 'image/gif' && !document.querySelector('#export').disabled);
});
