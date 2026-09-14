/* Corner Gradient — dependency-free contour geometry and Canvas 2D renderer. */
import { readRenderSettings } from './render-settings.js';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const copyPoints = points => points.map(p => ({ x: p.x, y: p.y }));
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// Animate positive gaps instead of clamping individual points. This keeps the
// contour ordered with smooth velocities, even for nearly coincident anchors.
// The inverse maps pointer edits on the moving contour back to the base shape.
function wavePoints(points, settings, phase, inverse = false) {
  const result = copyPoints(points);
  if (!settings.waveEnabled || !settings.waveAmplitude) return result;
  const strength = settings.waveAmplitude / 100 * 3 * (inverse ? -1 : 1);
  const wave = (position, offset) => {
    const spatial = position * Math.PI * 2 / settings.waveLength;
    const primary = Math.sin(spatial - phase + offset);
    const detail = .45 * Math.sin(spatial * 1.73 - phase * 1.31 + offset + 1.2)
      + .2 * Math.sin(spatial * 2.41 + phase * .73 + offset + 2.7);
    return (primary + settings.waveComplexity * detail) / (1 + settings.waveComplexity * .65);
  };
  for (const axis of ['x', 'y']) {
    const order = axis === 'x' ? [3, 2, 1, 0] : [0, 1, 2, 3];
    const reach = points[order[3]][axis];
    const offset = axis === 'x' ? 0 : 1.1;
    const edge = Math.exp(-strength * settings.waveEdges * wave(axis === 'x' ? 0 : 1, offset));
    const animatedReach = reach / (reach + (1 - reach) * edge);
    const gaps = [0, 1, 2].map(i => {
      const position = axis === 'x' ? 1 - (i + .5) / 3 : (i + .5) / 3;
      return (points[order[i + 1]][axis] - points[order[i]][axis])
        * Math.exp(strength * wave(position, offset));
    });
    const total = gaps.reduce((sum, gap) => sum + gap, 0);
    let cumulative = 0;
    result[order[0]][axis] = 0;
    for (let i = 0; i < 2; i++) {
      cumulative += gaps[i];
      result[order[i + 1]][axis] = animatedReach * cumulative / total;
    }
    result[order[3]][axis] = animatedReach;
  }
  return result;
}

// Shape-preserving Hermite derivatives. Applying this independently to x and y
// gives a C1-continuous sequence of cubic Beziers through all four anchors.
function slopes(values) {
  const d = values.slice(1).map((v, i) => v - values[i]);
  const m = new Array(values.length).fill(0);
  for (let i = 1; i < values.length - 1; i++) {
    if (d[i - 1] * d[i] > 0) m[i] = 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]);
  }
  function end(a, b) {
    const v = (3 * a - b) / 2;
    if (v * a <= 0) return 0;
    return Math.sign(a) * Math.min(Math.abs(v), 3 * Math.abs(a));
  }
  m[0] = end(d[0], d[1]);
  m[m.length - 1] = end(d[d.length - 1], d[d.length - 2]);
  return m;
}

function segments(points, mode = 'Through anchors') {
  if (mode === 'Cubic handles') return [copyPoints(points)];
  const mx = slopes(points.map(p => p.x));
  const my = slopes(points.map(p => p.y));
  return points.slice(0, -1).map((p, i) => [
    { ...p },
    { x: p.x + mx[i] / 3, y: p.y + my[i] / 3 },
    { x: points[i + 1].x - mx[i + 1] / 3, y: points[i + 1].y - my[i + 1] / 3 },
    { ...points[i + 1] }
  ]);
}

function evaluate(s, t) {
  const u = 1 - t;
  return {
    x: u*u*u*s[0].x + 3*u*u*t*s[1].x + 3*u*t*t*s[2].x + t*t*t*s[3].x,
    y: u*u*u*s[0].y + 3*u*u*t*s[1].y + 3*u*t*t*s[2].y + t*t*t*s[3].y
  };
}

// q = y / (x + y) uniquely identifies a ray from the bottom-right corner.
// The field at a pixel is 1 - radius / contourRadius on that ray. L1 radii
// yield the same ratio as Euclidean radii, without per-pixel trigonometry.
// The texture/table coordinate is u = sqrt(y) / (sqrt(x) + sqrt(y)).
// This concentrates samples near both edges, where a tangential Bezier has a
// rapidly changing radial distance. The inverse is q = u² / (u² + (1-u)²).
// Ordered coordinates ensure one contour intersection per ray; no folded fill.
function radialLUT(curves, count = 4096) {
  const table = new Float32Array(count + 1);
  const ends = curves.map(s => s[3].y / (s[3].x + s[3].y));
  let segmentIndex = 0;
  table[0] = curves[0][0].x;
  table[count] = curves[curves.length - 1][3].y;
  for (let i = 1; i < count; i++) {
    const u = i / count, v = 1 - u;
    const q = u * u / (u * u + v * v);
    while (segmentIndex < curves.length - 1 && q > ends[segmentIndex]) segmentIndex++;
    const s = curves[segmentIndex];
    let lo = 0, hi = 1, p;
    for (let j = 0; j < 21; j++) {
      const t = (lo + hi) / 2;
      p = evaluate(s, t);
      if (p.y * (1 - q) - p.x * q < 0) lo = t;
      else hi = t;
    }
    p = evaluate(s, (lo + hi) / 2);
    table[i] = p.x + p.y;
  }
  return table;
}

function transferLUT(settings, count = 8192) {
  const lut = new Float32Array(count + 1);
  for (let i = 0; i <= count; i++) {
    let t = i / count;
    if (settings.blend === 'Smooth') t = t * t * (3 - 2 * t);
    lut[i] = Math.pow(t, settings.falloff);
  }
  return lut;
}

function colorRGB(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Use a six-digit hex color.');
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

function prepare(points, settings) {
  const curves = segments(points, settings.mode);
  const pattern = readRenderSettings(settings);
  return { curves, radial: radialLUT(curves), transfer: transferLUT(settings),
    rgb: colorRGB(settings.color), points: copyPoints(points), dither: settings.dither,
    pattern };
}

function intensityAt(x, y, model) {
  const { radial, transfer } = model;
  const n = radial.length - 1, m = transfer.length - 1;
  const radius = x + y;
  const q = radius ? Math.sqrt(y) / (Math.sqrt(x) + Math.sqrt(y)) * n : 0;
  const a = Math.min(n - 1, Math.floor(q)), f = q - a;
  const boundary = radial[a] * (1 - f) + radial[a + 1] * f;
  const t = clamp(1 - radius / Math.max(boundary, 1e-12), 0, 1) * m;
  const b = Math.min(m - 1, Math.floor(t));
  return transfer[b] * (1 - (t - b)) + transfer[b + 1] * (t - b);
}

// Exact box-filter coverage of a periodic stripe, including subpixel lines.
// Coordinates are in cells, with a stripe centered on each integer.
function stripeCoverage(position, thickness, footprint) {
  const integral = t => {
    const shifted = t + thickness / 2, whole = Math.floor(shifted);
    return whole * thickness + Math.min(shifted - whole, thickness);
  };
  return clamp((integral(position + footprint / 2) - integral(position - footprint / 2)) / footprint, 0, 1);
}

function orderedIntensity(plan, col, py) {
  const { cellPixels, orderedTones, orderedSizes, toneColumns } = plan;
  const dx = plan.width - 1 - plan.startX - col, dy = plan.height - 1 - py;
  if (!dx && !dy) return 1; // Preserve the exact chosen corner color.
  const u = dx / cellPixels, v = dy / cellPixels;
  const cx = Math.round(u), cy = Math.round(v);
  const index = cy * toneColumns + cx;
  const footprint = 1 / cellPixels, size = orderedSizes[index];
  const coverage = stripeCoverage(u, size, footprint) * stripeCoverage(v, size, footprint);
  return orderedTones[index] * coverage;
}

function renderPlan(ctx, width, height, model) {
  if (!ctx || width < 2 || height < 2) throw new Error('A valid canvas is required.');
  const startX = clamp(Math.floor((1 - model.points[0].x) * (width - 1)), 0, width - 1);
  const startY = clamp(Math.floor((1 - model.points[3].y) * (height - 1)), 0, height - 1);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  const rw = width - startX, rh = height - startY;
  const xs = new Float64Array(rw), roots = new Float64Array(rw);
  for (let x = 0; x < rw; x++) {
    xs[x] = (width - 1 - startX - x) / (width - 1);
    roots[x] = Math.sqrt(xs[x]);
  }
  const shortSide = Math.min(width - 1, height - 1), p = model.pattern;
  const cellPixels = shortSide * p.orderedSpacing / 100;
  const plan = { ctx, width, height, startX, startY, rw, rh, xs, roots, model, cellPixels };
  if (p.renderStyle === 'Ordered dither') {
    // Sample once per square so each dot has one consistent size and tone.
    const toneColumns = Math.ceil((rw - 1) / cellPixels) + 1;
    const toneRows = Math.ceil((rh - 1) / cellPixels) + 1;
    const tones = new Float32Array(toneColumns * toneRows), levels = p.orderedLevels - 1;
    const sizes = new Float64Array(tones.length), sizeFade = p.orderedSizeFade / 100;
    for (let y = 0; y < toneRows; y++) for (let x = 0; x < toneColumns; x++) {
      const value = Math.pow(intensityAt(x * cellPixels / (width - 1), y * cellPixels / (height - 1), model), p.orderedContrast);
      const threshold = (BAYER[(y & 3) * 4 + (x & 3)] + .5) / 16;
      const index = y * toneColumns + x;
      tones[index] = Math.floor(value * levels + threshold) / levels;
      // Use the continuous tone, before Bayer quantization, to avoid size steps.
      // At full strength the square's area follows the tone; zero keeps fixed dots.
      sizes[index] = p.orderedDotSize / 100 * (1 - sizeFade + sizeFade * Math.sqrt(value));
    }
    plan.orderedTones = tones; plan.orderedSizes = sizes; plan.toneColumns = toneColumns;
  }
  return plan;
}

function drawRows(plan, firstRow, rows) {
  const { ctx, width, height, startX, startY, rw, xs, roots, model } = plan;
  const { radial, transfer, rgb, dither } = model;
  const data = ctx.createImageData(rw, rows);
  const pixels = data.data, n = radial.length - 1, m = transfer.length - 1;
  let offset = 0;
  for (let row = 0; row < rows; row++) {
    const py = startY + firstRow + row;
    const y = (height - 1 - py) / (height - 1), rootY = Math.sqrt(y);
    for (let col = 0; col < rw; col++, offset += 4) {
      pixels[offset + 3] = 255;
      const x = xs[col], radius = x + y;
      const qi = radius ? clamp(rootY / (roots[col] + rootY) * n, 0, n) : 0;
      const a = Math.min(n - 1, Math.floor(qi)), f = qi - a;
      const boundary = radial[a] * (1 - f) + radial[a + 1] * f;
      const t = 1 - radius / Math.max(boundary, 1e-12);
      if (t <= 0) continue; // Exact black outside the contour; never dither it.
      const ti = clamp(t * m, 0, m), b = Math.min(m - 1, Math.floor(ti)), tf = ti - b;
      let intensity = transfer[b] * (1 - tf) + transfer[b + 1] * tf;
      if (model.pattern.renderStyle === 'Ordered dither') {
        intensity = orderedIntensity(plan, col, py);
        for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round(rgb[c] * intensity);
        continue;
      }
      let noise = 0;
      if (dither === 'Fine grain') {
        let hash = Math.imul((startX + col) + Math.imul(py, width), 0x45d9f3b);
        hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
        noise = ((hash ^ (hash >>> 16)) >>> 0) / 4294967296 - 0.5;
      } else if (dither === 'Ordered 4 × 4') {
        noise = (BAYER[(py & 3) * 4 + ((startX + col) & 3)] + 0.5) / 16 - 0.5;
      }
      // Fade quantization noise near both ends, preserving the chosen corner color.
      noise *= Math.min(1, intensity * 255, (1 - intensity) * 255);
      for (let c = 0; c < 3; c++) {
        pixels[offset + c] = Math.round(clamp(rgb[c] * intensity + noise, 0, rgb[c]));
      }
    }
  }
  ctx.putImageData(data, startX, startY + firstRow);
}

function render(ctx, width, height, model) {
  const plan = renderPlan(ctx, width, height, model);
  drawRows(plan, 0, plan.rh);
}

async function renderAsync(ctx, width, height, model, onProgress = () => {}) {
  const plan = renderPlan(ctx, width, height, model);
  for (let row = 0; row < plan.rh; row += 96) {
    drawRows(plan, row, Math.min(96, plan.rh - row));
    onProgress(Math.min(1, (row + 96) / plan.rh));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

const CornerEngine = Object.freeze({ clamp, copyPoints, wavePoints, segments, evaluate,
  radialLUT, transferLUT, colorRGB, prepare, render, renderAsync });

export default CornerEngine;
