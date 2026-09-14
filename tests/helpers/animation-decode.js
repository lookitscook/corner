import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { GifReader } from 'omggif';

export function decodeGIF(bytes) {
  const reader = new GifReader(bytes), frames = [];
  for (let i = 0; i < reader.numFrames(); i++) {
    const rgba = new Uint8Array(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(i, rgba);
    const info = reader.frameInfo(i);
    assert.equal(info.transparent_index, null);
    frames.push({ rgba, delay: info.delay / 100 });
  }
  return { width: reader.width, height: reader.height, plays: reader.loopCount(), frames };
}

export function decodeAPNG(input) {
  const bytes = Buffer.from(input);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let width, height, count, plays, sequence = 0, ended = false;
  const frames = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(at + 4, at + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32BE(at + 8 + length), `${type} CRC`);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8)], [8, 6, 0, 0, 0]);
    } else if (type === 'acTL') {
      count = data.readUInt32BE(0); plays = data.readUInt32BE(4);
    } else if (type === 'fcTL') {
      assert.equal(data.readUInt32BE(0), sequence++);
      assert.equal(data.readUInt32BE(4), width); assert.equal(data.readUInt32BE(8), height);
      assert.equal(data.readUInt32BE(12), 0); assert.equal(data.readUInt32BE(16), 0);
      assert.equal(data[24], 0); assert.equal(data[25], 0);
      frames.push({ delay: data.readUInt16BE(20) / data.readUInt16BE(22), chunks: [] });
    } else if (type === 'IDAT') {
      assert.equal(frames.length, 1); frames[0].chunks.push(data);
    } else if (type === 'fdAT') {
      assert.equal(data.readUInt32BE(0), sequence++); frames.at(-1).chunks.push(data.subarray(4));
    } else if (type === 'IEND') { ended = true; assert.equal(at + length + 12, bytes.length); }
    at += length + 12;
  }
  assert(ended); assert.equal(frames.length, count);
  for (const frame of frames) {
    const raw = inflateSync(Buffer.concat(frame.chunks)), stride = width * 4;
    assert.equal(raw.length, (stride + 1) * height);
    const rgba = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
      const row = y * (stride + 1), dst = y * stride;
      assert.equal(raw[row], 1);
      for (let x = 0; x < stride; x++) rgba[dst + x] = raw[row + x + 1] + (x >= 4 ? rgba[dst + x - 4] : 0);
    }
    frame.rgba = rgba; delete frame.chunks;
  }
  return { width, height, plays, frames };
}
