import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';

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
