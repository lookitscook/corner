/* Small native-input fallback for offline use. This is NOT dat.gui.
   The application replaces it with the actual dat.gui panel when that loads. */
(function () {
  'use strict';
  let nextId = 0;
  class Control {
    constructor(parent, object, property, args, color = false) {
      this.object = object; this.property = property;
      this.change = () => {}; this.finish = () => {};
      this.domElement = document.createElement('li');
      this.domElement.className = 'cr';
      this.label = document.createElement('label');
      this.label.className = 'property-name';
      this.label.textContent = property;
      const cell = document.createElement('div'); cell.className = 'c';
      this.domElement.append(this.label, cell);
      const value = object[property];
      if (color) {
        this.domElement.classList.add('color');
        this.swatch = document.createElement('input'); this.swatch.type = 'color';
        this.input = document.createElement('input'); this.input.type = 'text'; this.input.maxLength = 7;
        cell.classList.add('native-color'); cell.append(this.swatch, this.input);
        this.swatch.addEventListener('input', () => this.setValue(this.swatch.value));
        this.swatch.addEventListener('change', () => this.finish(this.object[property]));
      } else if (args[0] && typeof args[0] === 'object') {
        this.domElement.classList.add('string');
        this.input = document.createElement('select');
        const choices = Array.isArray(args[0]) ? Object.fromEntries(args[0].map(v => [v, v])) : args[0];
        Object.entries(choices).forEach(([label, value]) => {
          const option = document.createElement('option'); option.textContent = label; option.value = value;
          this.input.append(option);
        });
        cell.append(this.input);
      } else if (typeof value === 'boolean') {
        this.domElement.classList.add('boolean');
        this.input = document.createElement('input'); this.input.type = 'checkbox'; cell.append(this.input);
      } else if (typeof value === 'number') {
        this.domElement.classList.add('number');
        this.input = document.createElement('input'); this.input.type = 'number';
        if (Number.isFinite(args[0]) && Number.isFinite(args[1])) {
          this.range = document.createElement('input'); this.range.type = 'range';
          cell.classList.add('native-number'); cell.append(this.range);
          this.range.addEventListener('input', () => this.setValue(Number(this.range.value)));
          this.range.addEventListener('change', () => this.finish(this.object[property]));
          this.min(args[0]); this.max(args[1]);
        }
        this.step(args[2] || 'any'); cell.append(this.input);
      } else {
        this.domElement.classList.add('string');
        this.input = document.createElement('input'); this.input.type = 'text'; cell.append(this.input);
      }
      this.input.id = `native-control-${++nextId}`;
      this.label.htmlFor = this.input.id;
      this.input.addEventListener('input', () => {
        const v = this.input.type === 'checkbox' ? this.input.checked :
          this.input.type === 'number' ? Number(this.input.value) : this.input.value;
        if (this.input.type === 'number' && (!this.input.value || !Number.isFinite(v))) return;
        if (color && !/^#[0-9a-f]{6}$/i.test(v)) return;
        this.setValue(v, false);
      });
      this.input.addEventListener('change', () => this.finish(this.object[property]));
      this.input.addEventListener('blur', () => this.updateDisplay(true));
      parent.list.append(this.domElement); this.updateDisplay();
    }
    setValue(value, refresh = true) { this.object[this.property] = value; this.change(value); if (refresh) this.updateDisplay(); return this; }
    getValue() { return this.object[this.property]; }
    name(text) { this.label.textContent = text; return this; }
    min(v) { if (this.range) this.range.min = v; if (this.input) this.input.min = v; return this; }
    max(v) { if (this.range) this.range.max = v; if (this.input) this.input.max = v; return this; }
    step(v) { if (this.range) this.range.step = v; if (this.input) this.input.step = v; return this; }
    onChange(fn) { this.change = fn; return this; }
    onFinishChange(fn) { this.finish = fn; return this; }
    updateDisplay(force = false) {
      const v = this.object[this.property];
      if (this.input.type === 'checkbox') this.input.checked = Boolean(v);
      else if (force || document.activeElement !== this.input) this.input.value = typeof v === 'number' ? +v.toFixed(2) : v;
      if (this.range) this.range.value = v;
      if (this.swatch) this.swatch.value = v;
      return this;
    }
  }
  class NativeGUI {
    constructor() {
      this.domElement = document.createElement('div'); this.domElement.className = 'dg main native-gui';
      this.list = document.createElement('ul'); this.domElement.append(this.list);
    }
    add(object, property, ...args) { return new Control(this, object, property, args); }
    addColor(object, property) { return new Control(this, object, property, [], true); }
    addFolder(name) {
      const item = document.createElement('li'); item.className = 'folder';
      const details = document.createElement('details');
      const title = document.createElement('summary'); title.className = 'title'; title.textContent = name;
      const child = new NativeGUI(); child.details = details;
      details.append(title, child.domElement); item.append(details); this.list.append(item);
      return child;
    }
    open() { if (this.details) this.details.open = true; return this; }
    close() { if (this.details) this.details.open = false; return this; }
    destroy() { this.domElement.remove(); }
  }
  window.NativeGUI = NativeGUI;
})();
