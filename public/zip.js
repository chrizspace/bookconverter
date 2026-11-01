const encoder = new TextEncoder();
const limit = 0xffffffff;
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

export async function crc32(blob) {
  let crc = limit;
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const byte of value) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    }
  } finally {
    reader.releaseLock();
  }
  return (crc ^ limit) >>> 0;
}

function header(size, signature) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  return { bytes, view };
}

// Stored entries preserve scans exactly; only the small central directory stays in memory.
export class ZipWriter {
  constructor(sink) {
    this.sink = sink;
    this.offset = 0;
    this.entries = [];
  }

  async write(bytes) {
    await this.sink.write(bytes);
    this.offset += bytes.byteLength;
  }

  async add(name, input) {
    const blob = input instanceof Blob ? input : new Blob([input]);
    if (blob.size >= limit) throw new Error('A single scan must be smaller than 4 GiB.');
    const filename = encoder.encode(name);
    const crc = await crc32(blob);
    const offset = this.offset;
    const { bytes, view } = header(30, 0x04034b50);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint16(12, 0x21, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, blob.size, true);
    view.setUint32(22, blob.size, true);
    view.setUint16(26, filename.length, true);
    await this.write(bytes);
    await this.write(filename);
    const reader = blob.stream().getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        await this.write(value);
      }
    } finally {
      reader.releaseLock();
    }
    this.entries.push({ filename, size: blob.size, crc, offset });
  }

  async finish() {
    const start = this.offset;
    for (const entry of this.entries) {
      const large = entry.offset >= limit;
      const { bytes, view } = header(46, 0x02014b50);
      view.setUint16(4, large ? 45 : 20, true);
      view.setUint16(6, large ? 45 : 20, true);
      view.setUint16(8, 0x800, true);
      view.setUint16(14, 0x21, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.filename.length, true);
      view.setUint16(30, large ? 12 : 0, true);
      view.setUint32(42, large ? limit : entry.offset, true);
      await this.write(bytes);
      await this.write(entry.filename);
      if (large) {
        const extra = new Uint8Array(12);
        const extraView = new DataView(extra.buffer);
        extraView.setUint16(0, 1, true);
        extraView.setUint16(2, 8, true);
        extraView.setBigUint64(4, BigInt(entry.offset), true);
        await this.write(extra);
      }
    }
    const size = this.offset - start;
    const count = this.entries.length;
    if (start >= limit || size >= limit || count >= 65535) {
      const position = this.offset;
      const { bytes, view } = header(56, 0x06064b50);
      view.setBigUint64(4, 44n, true);
      view.setUint16(12, 45, true);
      view.setUint16(14, 45, true);
      view.setBigUint64(24, BigInt(count), true);
      view.setBigUint64(32, BigInt(count), true);
      view.setBigUint64(40, BigInt(size), true);
      view.setBigUint64(48, BigInt(start), true);
      await this.write(bytes);
      const locator = header(20, 0x07064b50);
      locator.view.setBigUint64(8, BigInt(position), true);
      locator.view.setUint32(16, 1, true);
      await this.write(locator.bytes);
    }
    const { bytes, view } = header(22, 0x06054b50);
    view.setUint16(8, Math.min(count, 65535), true);
    view.setUint16(10, Math.min(count, 65535), true);
    view.setUint32(12, Math.min(size, limit), true);
    view.setUint32(16, Math.min(start, limit), true);
    await this.write(bytes);
  }
}
