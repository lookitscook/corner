/* Corner Gradient Studio — Vite entry point. */
import { GUI } from 'dat.gui';
import E from './engine.js';
import './styles.css';

// Preserve the renderer API for integrations and browser verification.
window.CornerEngine = E;
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'corner-gradient-studio.v1';
  const FORMATS = { '4K UHD': [3840, 2160], '1080p': [1920, 1080],
    'Square': [2048, 2048], 'Portrait': [2160, 3840], 'Custom': null };
  const PRESETS = {
    'Sketch': [[1, 0], [.61, .105], [.25, .385], [0, 1]],
    'Round': [[1, 0], [.866, .5], [.5, .866], [0, 1]],
    'Wide': [[1, 0], [.64, .045], [.25, .2], [0, .6]],
    'Tall': [[.6, 0], [.4, .2], [.15, .52], [0, 1]],
    'Diagonal': [[1, 0], [2/3, 1/3], [1/3, 2/3], [0, 1]]
  };
  const WAVE_DEFAULTS = { waveEnabled: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, waveAmplitude: 12, waveSpeed: .12,
    waveLength: 1.4, waveComplexity: .4, waveEdges: .35 };
  const WAVE_RANGES = { waveAmplitude: [0, 35, .5], waveSpeed: [0, 1, .01],
    waveLength: [.3, 3, .05], waveComplexity: [0, 1, .05], waveEdges: [0, 1, .05] };
  const DEFAULT_SETTINGS = { ...WAVE_DEFAULTS, color: '#606060', size: 40, falloff: 1,
    blend: 'Smooth', dither: 'Fine grain', mode: 'Through anchors',
    preset: 'Sketch', width: 3840, height: 2160, format: '4K UHD',
    bottom: 40, right: 40, bx: 24.4, by: 4.2, cx: 10, cy: 15.4 };
  const settings = { ...DEFAULT_SETTINGS };
  const presetPoints = (name, size) => PRESETS[name].map(([x, y]) => ({ x: x * size, y: y * size }));
  let points = presetPoints('Sketch', .4);
  let showContour = true, selected = true, selectedIndex = -1, drag = null;
  let cssWidth = 800, cssHeight = 450, model = null, geometryDirty = true, paintDirty = true;
  let framePending = false, gui = null, controllers = [], folderMap = {};
  let toastTimer, saveTimer, busy = false, history = [], historyIndex = 0;
  let lastColor = settings.color, storageAvailable = true;
  let wavePhase = 0, lastFrameTime = null;
  let displayPoints = E.copyPoints(points);
  const canvas = $('gradient'), overlay = $('overlay'), wrap = $('artboard-wrap');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) { $('toast').textContent = 'Your browser could not create a canvas.'; $('toast').classList.add('show'); return; }

  function extent() { return Math.max(points[0].x, points[3].y); }
  function currentFormat() {
    return Object.keys(FORMATS).find(name => FORMATS[name] &&
      FORMATS[name][0] === settings.width && FORMATS[name][1] === settings.height) || 'Custom';
  }
  function syncDerived() {
    settings.size = extent() * 100;
    settings.bottom = points[0].x * 100; settings.right = points[3].y * 100;
    settings.bx = points[1].x * 100; settings.by = points[1].y * 100;
    settings.cx = points[2].x * 100; settings.cy = points[2].y * 100;
    settings.format = currentFormat();
  }
  function stateObject() {
    const keys = ['color', 'falloff', 'blend', 'dither', 'mode', 'preset', 'width', 'height', ...Object.keys(WAVE_DEFAULTS)];
    return { format: 'corner-gradient', version: 1,
      settings: Object.fromEntries(keys.map(k => [k, settings[k]])), points: E.copyPoints(points) };
  }
  function snapshot() { return JSON.stringify(stateObject()); }

  // Only known, validated data fields can enter the model. Setup files are never executed.
  function validateState(data) {
    if (!data || data.format !== 'corner-gradient' || data.version !== 1 || !data.settings ||
      !Array.isArray(data.points) || data.points.length !== 4) throw new Error('This is not a Corner setup file (version 1).');
    const s = data.settings, p = data.points;
    if (typeof s.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(s.color)) throw new Error('The setup has an invalid color.');
    if (!Number.isFinite(s.falloff) || s.falloff < .25 || s.falloff > 4) throw new Error('Falloff must be between 0.25 and 4.');
    const validEnums = { blend: ['Smooth', 'Linear'], dither: ['Off', 'Fine grain', 'Ordered 4 × 4'],
      mode: ['Through anchors', 'Cubic handles'], preset: [...Object.keys(PRESETS), 'Custom'] };
    for (const [k, values] of Object.entries(validEnums)) if (!values.includes(s[k])) throw new Error(`Invalid ${k} option.`);
    if (!Number.isInteger(s.width) || !Number.isInteger(s.height) || s.width < 64 || s.height < 64 ||
      s.width > 4096 || s.height > 4096) throw new Error('Width and height must be integers between 64 and 4096.');
    for (const a of p) if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y) ||
      a.x < 0 || a.x > 1 || a.y < 0 || a.y > 1) throw new Error('All anchors must be inside the canvas.');
    if (p[0].y !== 0 || p[3].x !== 0 || p[0].x < .0001 || p[3].y < .0001)
      throw new Error('The endpoints must be on the bottom and right edges, away from the corner.');
    for (let i = 1; i < 4; i++) if (p[i].x >= p[i - 1].x || p[i].y <= p[i - 1].y)
      throw new Error('The anchors must stay ordered from the bottom edge to the right edge.');
    const clean = {};
    for (const k of ['color', 'falloff', 'blend', 'dither', 'mode', 'preset', 'width', 'height']) clean[k] = s[k];
    for (const [key, fallback] of Object.entries(WAVE_DEFAULTS)) {
      // Older version-1 setups retain their original static appearance.
      const value = s[key] === undefined ? (key === 'waveEnabled' ? false : fallback) : s[key];
      if (key === 'waveEnabled' ? typeof value !== 'boolean' :
        !Number.isFinite(value) || value < WAVE_RANGES[key][0] || value > WAVE_RANGES[key][1])
        throw new Error(`Invalid ${key} setting.`);
      clean[key] = value;
    }
    return { settings: clean, points: E.copyPoints(p) };
  }

  function toast(text) {
    clearTimeout(toastTimer); $('toast').textContent = text; $('toast').classList.add('show');
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4200);
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, snapshot()); $('save-status-text').textContent = 'Saved on this device'; storageAvailable = true; }
      catch (_) { $('save-status-text').textContent = 'Use Save setup to keep your work'; storageAvailable = false; }
    }, 350);
  }
  function refreshControls() { controllers.forEach(c => c.updateDisplay()); }
  function updateHistoryButtons() { $('undo').disabled = historyIndex <= 0; $('redo').disabled = historyIndex >= history.length - 1; }
  function commit() {
    const value = snapshot();
    if (value === history[historyIndex]) return;
    history = history.slice(0, historyIndex + 1); history.push(value);
    if (history.length > 80) history.shift();
    historyIndex = history.length - 1; updateHistoryButtons(); persist();
  }
  function applyState(data) {
    const clean = validateState(data);
    Object.assign(settings, clean.settings); points = clean.points;
    lastColor = settings.color; selected = true; selectedIndex = -1;
    syncDerived(); geometryDirty = paintDirty = true; fitArtboard(); refreshControls(); schedule(); persist();
  }
  function undo() { if (historyIndex > 0) { applyState(JSON.parse(history[--historyIndex])); updateHistoryButtons(); } }
  function redo() { if (historyIndex < history.length - 1) { applyState(JSON.parse(history[++historyIndex])); updateHistoryButtons(); } }
  function changed(geometry = false, custom = false) {
    if (custom) settings.preset = 'Custom';
    syncDerived(); if (geometry) geometryDirty = true;
    paintDirty = true; refreshControls(); schedule(); persist();
  }

  function resizeGradient(value) {
    const size = E.clamp(Number(value) || 2, 2, 100) / 100;
    const ratio = size / Math.max(extent(), .0001);
    points.forEach(p => { p.x *= ratio; p.y *= ratio; }); changed(true);
  }
  function moveAnchor(index, x, y, onWave = false) {
    if (onWave) points = E.wavePoints(points, settings, wavePhase);
    if (index === 0) {
      x = E.clamp(x, .005, 1); const ratio = x / points[0].x;
      points[0].x = x; points[1].x *= ratio; points[2].x *= ratio;
    } else if (index === 3) {
      y = E.clamp(y, .005, 1); const ratio = y / points[3].y;
      points[3].y = y; points[1].y *= ratio; points[2].y *= ratio;
    } else {
      const epsilon = Math.min(.00001, points[0].x / 50, points[3].y / 50);
      points[index].x = E.clamp(x, points[index + 1].x + epsilon, points[index - 1].x - epsilon);
      points[index].y = E.clamp(y, points[index - 1].y + epsilon, points[index + 1].y - epsilon);
    }
    if (onWave) points = E.wavePoints(points, settings, wavePhase, true);
    selectedIndex = index; selected = true; changed(true, true);
  }

  function addControl(folder, key, name, args, fn, color = false) {
    const c = color ? folder.addColor(settings, key) : folder.add(settings, key, ...(args || []));
    c.name(name).onChange(fn).onFinishChange(commit);
    const row = c.domElement.closest('li') || c.domElement;
    row.dataset.control = key;
    c.domElement.querySelectorAll('input,select').forEach(input => input.setAttribute('aria-label', name));
    controllers.push(c); return c;
  }
  function buildGUI() {
    const openness = Object.fromEntries(Object.entries(folderMap).map(([name, f]) =>
      [name, !f.closed]));
    if (gui) gui.destroy();
    $('gui-host').replaceChildren(); controllers = []; folderMap = {};
    gui = new GUI({ autoPlace: false, hideable: false, width: 286 });
    $('gui-host').append(gui.domElement);
    function folder(name, open = false) {
      const f = gui.addFolder(name); folderMap[name] = f;
      if (openness[name] ?? open) f.open(); else f.close();
      return f;
    }
    const gradient = folder('Gradient', true);
    addControl(gradient, 'color', 'Corner color', [], v => {
      if (/^#[0-9a-f]{6}$/i.test(v)) { settings.color = v.toLowerCase(); lastColor = settings.color; }
      else settings.color = lastColor;
      changed();
    }, true);
    addControl(gradient, 'size', 'Size %', [2, 100, .1], resizeGradient);
    addControl(gradient, 'falloff', 'Falloff', [.25, 4, .05], value => {
      settings.falloff = E.clamp(Number(value) || 1, .25, 4); changed();
    });
    const contour = folder('Contour', true);
    addControl(contour, 'preset', 'Starting shape', [[...Object.keys(PRESETS), 'Custom']], value => {
      if (PRESETS[value]) { points = presetPoints(value, extent()); selectedIndex = -1; selected = true; changed(true); }
    });
    addControl(contour, 'mode', 'Curve type', [['Through anchors', 'Cubic handles']], () => changed(true));
    addControl(contour, 'bottom', 'Bottom reach %', [.5, 100, .1], value => moveAnchor(0, Number(value) / 100, 0));
    addControl(contour, 'right', 'Right reach %', [.5, 100, .1], value => moveAnchor(3, 0, Number(value) / 100));
    const motion = folder('Wave motion', true);
    addControl(motion, 'waveEnabled', 'Animate', [], () => { lastFrameTime = null; changed(true); fitArtboard(); });
    const waveLabels = { waveAmplitude: 'Amplitude %', waveSpeed: 'Speed · Hz', waveLength: 'Wavelength',
      waveComplexity: 'Complexity', waveEdges: 'Edge movement' };
    for (const [key, range] of Object.entries(WAVE_RANGES)) {
      addControl(motion, key, waveLabels[key], range, value => {
        settings[key] = E.clamp(Number.isFinite(Number(value)) ? Number(value) : WAVE_DEFAULTS[key], range[0], range[1]);
        changed(true);
      });
    }
    const finish = folder('Finish');
    addControl(finish, 'blend', 'Blend profile', [['Smooth', 'Linear']], () => changed());
    addControl(finish, 'dither', 'Dither', [['Off', 'Fine grain', 'Ordered 4 × 4']], () => changed());
    const middle = folder('Middle anchors');
    addControl(middle, 'bx', 'B · left %', [0, 100, .1], value => moveAnchor(1, Number(value) / 100, points[1].y));
    addControl(middle, 'by', 'B · up %', [0, 100, .1], value => moveAnchor(1, points[1].x, Number(value) / 100));
    addControl(middle, 'cx', 'C · left %', [0, 100, .1], value => moveAnchor(2, Number(value) / 100, points[2].y));
    addControl(middle, 'cy', 'C · up %', [0, 100, .1], value => moveAnchor(2, points[2].x, Number(value) / 100));
    const output = folder('Canvas & export');
    addControl(output, 'format', 'Format', [Object.keys(FORMATS)], value => {
      if (FORMATS[value]) { [settings.width, settings.height] = FORMATS[value]; fitArtboard(); changed(); }
    });
    for (const key of ['width', 'height']) addControl(output, key, `${key[0].toUpperCase() + key.slice(1)} px`, [64, 4096, 1], value => {
      settings[key] = Math.round(E.clamp(Number(value) || 64, 64, 4096)); fitArtboard(); changed();
    });
    // Give the original dat.gui folder titles keyboard support as well.
    gui.domElement.querySelectorAll('li.title').forEach(title => {
      title.tabIndex = 0; title.setAttribute('role', 'button');
      title.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); title.click(); } });
    });
    refreshControls();
  }

  const anchorElements = [];
  for (let i = 0; i < 4; i++) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('anchor'); group.dataset.index = i; group.setAttribute('tabindex', '0'); group.setAttribute('role', 'button');
    group.innerHTML = `<circle class="anchor-hit" r="20"/><circle class="anchor-aura" r="14"/>` +
      (i === 0 || i === 3 ? '<rect class="anchor-ring" x="-5.5" y="-5.5" width="11" height="11" rx="2"/>' : '<circle class="anchor-ring" r="6"/>') +
      '<circle class="anchor-core" r="2"/><text class="anchor-label">' + 'ABCD'[i] + '</text>';
    $('anchors').append(group); anchorElements.push(group);
    group.addEventListener('focus', () => { selectedIndex = i; selected = true; schedule(); });
  }
  function screenPoint(p) { return { x: (1 - p.x) * cssWidth, y: (1 - p.y) * cssHeight }; }
  function updateOverlay() {
    const points = displayPoints;
    overlay.classList.toggle('preview', !showContour);
    overlay.classList.toggle('unselected', !selected);
    overlay.setAttribute('aria-hidden', String(!showContour));
    $('edit-view').setAttribute('aria-pressed', String(showContour));
    $('preview-view').setAttribute('aria-pressed', String(!showContour));
    const curves = E.segments(points, settings.mode), start = screenPoint(curves[0][0]);
    let path = `M${start.x},${start.y}`;
    for (const s of curves) {
      const c1 = screenPoint(s[1]), c2 = screenPoint(s[2]), end = screenPoint(s[3]);
      path += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`;
    }
    for (const id of ['curve-back', 'curve-line', 'curve-hit']) $(id).setAttribute('d', path);
    const poly = points.map((p, i) => { const s = screenPoint(p); return `${i ? 'L' : 'M'}${s.x},${s.y}`; }).join(' ');
    $('control-polygon').setAttribute('d', poly);
    $('control-polygon').style.display = settings.mode === 'Cubic handles' && selected ? '' : 'none';
    $('anchors').style.display = selected ? '' : 'none';
    anchorElements.forEach((group, i) => {
      const p = screenPoint(points[i]); group.setAttribute('transform', `translate(${p.x},${p.y})`);
      group.classList.toggle('active', i === selectedIndex); group.classList.toggle('dragging', Boolean(drag && drag.index === i));
      group.setAttribute('aria-label', `Anchor ${'ABCD'[i]}, ${(points[i].x * 100).toFixed(1)} percent left of the corner, ${(points[i].y * 100).toFixed(1)} percent up. Use arrow keys to move.`);
      const label = group.querySelector('text');
      label.setAttribute('x', i === 0 ? -3 : i === 3 ? 14 : p.x > cssWidth - 30 ? -17 : 12);
      label.setAttribute('y', i === 0 ? 24 : i === 3 ? 4 : -13);
    });
    $('corner-mark').setAttribute('d', `M${cssWidth - 10},${cssHeight + 7}h17v-17`);
    $('corner-mark').style.display = selected ? '' : 'none';
    $('curve-caption').textContent = settings.mode === 'Through anchors' ? '4 anchors · 3 Bézier segments' : '2 anchors · 2 Bézier handles';
    $('curve-note').textContent = settings.mode === 'Through anchors' ?
      'Through anchors: all four points sit on the contour. Their order is preserved to keep the fade smooth and free of loops.' :
      'Cubic handles: A and D are on the curve. B and C are off-curve control handles for a single cubic Bézier.';
    if (selectedIndex >= 0 && selected && showContour) {
      const p = points[selectedIndex]; $('anchor-title').textContent = `ANCHOR ${'ABCD'[selectedIndex]}`;
      $('anchor-kind').textContent = selectedIndex === 0 ? 'bottom edge' : selectedIndex === 3 ? 'right edge' : settings.mode === 'Through anchors' ? 'on-curve point' : 'control handle';
      $('anchor-coordinates').textContent = `Left ${(p.x * 100).toFixed(1)}%  /  Up ${(p.y * 100).toFixed(1)}%`;
    } else {
      $('anchor-title').textContent = showContour ? selected ? 'CONTOUR SELECTED' : 'SELECT THE CONTOUR' : 'CLEAN PREVIEW';
      $('anchor-kind').textContent = showContour ? '4 points' : 'no overlays';
      $('anchor-coordinates').textContent = showContour ? 'Select a point to fine-tune its position.' : 'Exports never include the editing guides.';
    }
    $('color-chip').style.background = settings.color; $('color-label').textContent = settings.color.toUpperCase();
    $('dimensions-label').textContent = `${settings.width} × ${settings.height} px`;
    function gcd(a, b) { return b ? gcd(b, a % b) : a; }
    const divisor = gcd(settings.width, settings.height);
    const ratio = `${settings.width / divisor}:${settings.height / divisor}`;
    $('ratio-badge').textContent = ratio.length > 9 ? `${(settings.width / settings.height).toFixed(2)}:1` : ratio;
  }

  function schedule() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(timestamp => {
      framePending = false;
      const running = settings.waveEnabled && settings.waveAmplitude > 0 && settings.waveSpeed > 0 && !document.hidden;
      // Freeze phase during direct edits so handles stay under the pointer.
      const editing = Boolean(drag);
      if (running && !editing && lastFrameTime !== null) {
        wavePhase += Math.min((timestamp - lastFrameTime) / 1000, .05) * settings.waveSpeed * Math.PI * 2;
        geometryDirty = paintDirty = true;
      }
      lastFrameTime = running ? timestamp : null;
      if (geometryDirty || !model) {
        displayPoints = E.wavePoints(points, settings, wavePhase);
        model = E.prepare(displayPoints, settings); geometryDirty = false;
      }
      else if (paintDirty) { model.transfer = E.transferLUT(settings); model.rgb = E.colorRGB(settings.color); model.dither = settings.dither; }
      if (paintDirty) { E.render(ctx, canvas.width, canvas.height, model); paintDirty = false; }
      updateOverlay();
      if (running && !editing) schedule();
    });
  }
  function fitArtboard() {
    const availableWidth = $('stage-shell').clientWidth;
    if (!availableWidth) return;
    const aspect = settings.width / settings.height;
    const mobile = window.matchMedia('(max-width: 780px)').matches;
    const maxHeight = mobile ? Math.min(480, Math.max(280, window.innerHeight * .56)) : Math.max(150, $('stage-shell').clientHeight - 132);
    cssWidth = Math.min(availableWidth, maxHeight * aspect);
    cssHeight = cssWidth / aspect;
    wrap.style.width = `${cssWidth}px`; wrap.style.height = `${cssHeight}px`;
    overlay.setAttribute('viewBox', `0 0 ${cssWidth} ${cssHeight}`);
    const maxWidth = settings.waveEnabled ? 1280 : 1920;
    const density = Math.min(window.devicePixelRatio || 1, 2, maxWidth / cssWidth, (maxWidth * 9 / 16) / cssHeight);
    const w = Math.max(2, Math.round(cssWidth * density)), h = Math.max(2, Math.round(cssHeight * density));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; paintDirty = true; }
    schedule();
  }
  function setView(edit) { showContour = edit; if (edit) selected = true; schedule(); }
  $('edit-view').addEventListener('click', () => setView(true));
  $('preview-view').addEventListener('click', () => setView(false));
  $('curve-hit').addEventListener('keydown', e => {
    if (e.key === 'Enter') { selected = true; selectedIndex = -1; schedule(); }
  });
  overlay.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !showContour || drag) return;
    const group = e.target.closest('.anchor');
    if (group) {
      e.preventDefault();
      const index = Number(group.dataset.index); selected = true; selectedIndex = index;
      drag = { id: e.pointerId, index, startX: e.clientX, startY: e.clientY,
        x: displayPoints[index].x, y: displayPoints[index].y, width: cssWidth, height: cssHeight };
      overlay.setPointerCapture(e.pointerId); group.focus({ preventScroll: true }); schedule();
    } else if (e.target.id === 'curve-hit') { selected = true; selectedIndex = -1; schedule(); }
    else { selected = false; selectedIndex = -1; schedule(); }
  });
  overlay.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    e.preventDefault(); const factor = e.shiftKey ? .2 : 1;
    moveAnchor(drag.index, drag.x - (e.clientX - drag.startX) / drag.width * factor,
      drag.y - (e.clientY - drag.startY) / drag.height * factor, true);
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (overlay.hasPointerCapture(e.pointerId)) overlay.releasePointerCapture(e.pointerId);
    drag = null; commit(); schedule();
  }
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);
  overlay.addEventListener('lostpointercapture', e => { if (drag && drag.id === e.pointerId) { drag = null; commit(); schedule(); } });
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea,select') || e.target.isContentEditable) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.code === 'Space' && !e.target.closest('button,summary,li.title')) { e.preventDefault(); setView(!showContour); return; }
    if (e.key === 'Escape') { selected = false; selectedIndex = -1; schedule(); return; }
    if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey) { setView(true); return; }
    if (!showContour || !selected || selectedIndex < 0 || !e.key.startsWith('Arrow')) return;
    e.preventDefault(); const p = displayPoints[selectedIndex], step = e.shiftKey ? 10 : 1;
    moveAnchor(selectedIndex, p.x + (e.key === 'ArrowLeft' ? step / cssWidth : e.key === 'ArrowRight' ? -step / cssWidth : 0),
      p.y + (e.key === 'ArrowUp' ? step / cssHeight : e.key === 'ArrowDown' ? -step / cssHeight : 0), true);
    commit();
  });
  $('undo').addEventListener('click', undo); $('redo').addEventListener('click', redo);
  $('reset').addEventListener('click', () => {
    Object.assign(settings, DEFAULT_SETTINGS); points = presetPoints('Sketch', .4); lastColor = settings.color;
    wavePhase = 0; lastFrameTime = null;
    selected = true; selectedIndex = -1; showContour = true; changed(true); fitArtboard(); commit(); toast('Reset to the original sketch. Undo is available.');
  });

  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  $('export').addEventListener('click', async () => {
    if (busy) return;
    busy = true; $('export').disabled = true; $('export').classList.add('busy');
    const exportSettings = { ...settings }, exportPoints = E.copyPoints(displayPoints);
    let output;
    try {
      $('export-label').textContent = 'Rendering…';
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      output = document.createElement('canvas'); output.width = exportSettings.width; output.height = exportSettings.height;
      const outputContext = output.getContext('2d', { alpha: false });
      if (!outputContext) throw new Error('Not enough canvas memory. Try a smaller export.');
      await E.renderAsync(outputContext, output.width, output.height, E.prepare(exportPoints, exportSettings),
        progress => { $('export-label').textContent = `Rendering ${Math.round(progress * 100)}%`; });
      $('export-label').textContent = 'Encoding PNG…';
      const blob = await new Promise((resolve, reject) => {
        output.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoding failed. Try a smaller resolution.')), 'image/png');
      });
      download(blob, `corner-${exportSettings.color.slice(1)}-${output.width}x${output.height}.png`);
      toast(`Exported ${output.width} × ${output.height} PNG — no guides or handles.`);
    } catch (error) { console.error(error); toast(error.message || 'Export failed. Try a smaller resolution.'); }
    finally {
      if (output) { output.width = 1; output.height = 1; }
      busy = false; $('export').disabled = false; $('export').classList.remove('busy'); $('export-label').textContent = 'Export PNG';
    }
  });
  $('save-setup').addEventListener('click', () => {
    commit(); download(new Blob([JSON.stringify(stateObject(), null, 2)], { type: 'application/json' }), 'corner-gradient-setup.json');
    toast('Setup saved. Use Load setup to restore it later.');
  });
  $('load-setup').addEventListener('click', () => $('setup-file').click());
  $('setup-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      if (file.size > 65536) throw new Error('That setup is too large. Choose a Corner JSON file under 64 KB.');
      const text = await file.text(); applyState(JSON.parse(text)); commit(); toast('Setup restored.');
    } catch (error) { toast(error instanceof SyntaxError ? 'That file is not valid JSON.' : error.message); }
    finally { e.target.value = ''; }
  });

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { const clean = validateState(JSON.parse(saved)); Object.assign(settings, clean.settings); points = clean.points; lastColor = settings.color; }
  } catch (_) { storageAvailable = false; }
  if (!storageAvailable) $('save-status-text').textContent = 'Use Save setup to keep your work';
  syncDerived(); history = [snapshot()]; updateHistoryButtons();
  buildGUI(); fitArtboard();
  if (window.ResizeObserver) new ResizeObserver(fitArtboard).observe($('stage-shell'));
  window.addEventListener('resize', fitArtboard);
  document.addEventListener('visibilitychange', () => { lastFrameTime = null; if (!document.hidden) schedule(); });
  document.addEventListener('focusout', () => { lastFrameTime = null; schedule(); });
  window.addEventListener('beforeunload', () => { try { localStorage.setItem(STORAGE_KEY, snapshot()); } catch (_) {} });
  window.CornerStudio = Object.freeze({ getState: stateObject, setState: data => { applyState(data); commit(); },
    getGUI: () => gui, getPoints: () => E.copyPoints(points),
    getAnimatedPoints: () => E.copyPoints(displayPoints), reset: () => $('reset').click() });
})();
