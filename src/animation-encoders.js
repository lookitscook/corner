import gifenc from 'gifenc';
import { zlibSync } from 'fflate';

// gifenc exposes a function as its ESM default and an object through CommonJS.
const GIFEncoder = typeof gifenc === 'function' ? gifenc : gifenc.GIFEncoder;

const MAX_BYTES = 96 * 1024 * 1024;
const checkSize = size => {
  if (size > MAX_BYTES) throw new Error('The animation exceeds 96 MB. Reduce its size, frame rate, or duration.');
};
const uint32 = (...values) => {
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v));
  return bytes;
};
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data = new Uint8Array()) {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) bytes[i + 4] = type.charCodeAt(i);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < bytes.length - 4; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}

function apngEncoder({ width, height, frames, fps }) {
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  let size = 8, sequence = 0, added = 0;
  const append = bytes => { checkSize(size + bytes.length); size += bytes.length; parts.push(bytes); };
  const ihdr = new Uint8Array(13);
  ihdr.set(uint32(width, height)); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA, no interlace.
  append(chunk('IHDR', ihdr));
  append(chunk('acTL', uint32(frames, 0))); // Loop forever.
  return {
    addFrame(rgba) {
      if (added >= frames || rgba.length !== width * height * 4) throw new Error('Invalid APNG frame.');
      const control = new Uint8Array(26), view = new DataView(control.buffer);
      control.set(uint32(sequence++, width, height, 0, 0));
      view.setUint16(20, 1); view.setUint16(22, fps);
      // Full-canvas frames: keep after display, replace pixels on the next frame.
      control[24] = 0; control[25] = 0;
      append(chunk('fcTL', control));
      const stride = width * 4, filtered = new Uint8Array((stride + 1) * height);
      for (let y = 0; y < height; y++) {
        const row = y * (stride + 1), source = y * stride;
        filtered[row] = 1; // PNG Sub filter, applied independently on each row.
        for (let x = 0; x < stride; x++) filtered[row + 1 + x] = rgba[source + x] - (x < 4 ? 0 : rgba[source + x - 4]);
      }
      const compressed = zlibSync(filtered, { level: 6 });
      if (added === 0) append(chunk('IDAT', compressed));
      else {
        const data = new Uint8Array(compressed.length + 4);
        data.set(uint32(sequence++)); data.set(compressed, 4);
        append(chunk('fdAT', data));
      }
      added++;
    },
    finish() {
      if (added !== frames) throw new Error('The APNG is missing frames.');
      append(chunk('IEND'));
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      return bytes;
    },
  };
}

function gifEncoder({ width, height, frames, fps }, rgb) {
  const gif = GIFEncoder();
  // One palette for the entire loop avoids per-frame color flicker. This app's
  // color field lies on the black-to-corner-color ramp, including both endpoints.
  const palette = Array.from({ length: 256 }, (_, i) => rgb.map(c => Math.round(c * i / 255)));
  const norm = rgb.reduce((sum, c) => sum + c * c, 0);
  let added = 0;
  return {
    addFrame(rgba) {
      if (added >= frames || rgba.length !== width * height * 4) throw new Error('Invalid GIF frame.');
      const indexed = new Uint8Array(width * height);
      for (let i = 0; i < indexed.length; i++) {
        const p = i * 4;
        indexed[i] = norm ? Math.max(0, Math.min(255, Math.round((rgba[p] * rgb[0] + rgba[p + 1] * rgb[1] + rgba[p + 2] * rgb[2]) / norm * 255))) : 0;
      }
      // GIF stores centiseconds. Round cumulative times to avoid duration drift.
      const delay = (Math.round((added + 1) * 100 / fps) - Math.round(added * 100 / fps)) * 10;
      gif.writeFrame(indexed, width, height, { palette: added === 0 ? palette : undefined, repeat: 0, delay, dispose: 1 });
      added++; checkSize(gif.bytesView().length);
    },
    finish() {
      if (added !== frames) throw new Error('The GIF is missing frames.');
      gif.finish(); checkSize(gif.bytesView().length);
      return gif.bytes();
    },
  };
}

export function createAnimationEncoder(plan, rgb) {
  if (plan.format === 'GIF') return gifEncoder(plan, rgb);
  if (plan.format === 'APNG') return apngEncoder(plan);
  throw new Error('Unsupported animation format.');
}
