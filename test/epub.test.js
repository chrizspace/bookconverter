import test from 'node:test';
import assert from 'node:assert/strict';
import { writeEpub, xml } from '../public/epub.js';
import { ZipWriter, crc32 } from '../public/zip.js';

function unpack(bytes) {
  const entries = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0, 'Entries are uncompressed');
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    entries.set(name, { bytes: bytes.slice(start, start + size), crc: view.getUint32(offset + 14, true) });
    offset = start + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint32(bytes.length - 6, true), offset);
  assert.equal(view.getUint16(bytes.length - 12, true), entries.size);
  return entries;
}

const book = {
  title: 'An illustrated <book> & "more"', author: 'A & B', language: 'en',
  identifier: 'urn:uuid:test', publisher: 'Publisher', description: '<script>alert(1)</script>',
  rights: 'Permission granted', date: '2020-01-01', direction: 'rtl', coverPageId: 2,
};
const scans = [
  { id: 2, type: 'image/png', width: 640, height: 960 },
  { id: 1, type: 'image/jpeg', width: 1200, height: 800 },
];
const images = new Map([
  [2, new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' })],
  [1, new Blob([new Uint8Array([255, 216, 255, 4, 5, 6])], { type: 'image/jpeg' })],
]);

async function exportBytes(metadata = book, pages = scans, read = id => images.get(id), progress) {
  const chunks = [];
  await writeEpub(metadata, pages, read, { write: bytes => chunks.push(bytes) }, progress);
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

test('EPUB preserves original images, order, cover, layout and escaped metadata', async () => {
  const progress = [];
  const entries = unpack(await exportBytes(book, scans, undefined, (...values) => progress.push(values)));
  assert.equal(entries.keys().next().value, 'mimetype');
  const text = name => new TextDecoder().decode(entries.get(name).bytes);
  assert.equal(text('mimetype'), 'application/epub+zip');
  assert.match(text('META-INF/container.xml'), /full-path="EPUB\/package.opf"/);
  assert.deepEqual(entries.get('EPUB/images/1.png').bytes, new Uint8Array(await images.get(2).arrayBuffer()));
  assert.deepEqual(entries.get('EPUB/images/2.jpg').bytes, new Uint8Array(await images.get(1).arrayBuffer()));
  const opf = text('EPUB/package.opf');
  assert.match(opf, /An illustrated &lt;book&gt; &amp; &quot;more&quot;/);
  assert.match(opf, /<dc:creator id="author">A &amp; B<\/dc:creator>/);
  assert.match(opf, /<dc:publisher>Publisher<\/dc:publisher>/);
  assert.match(opf, /<dc:identifier id="book-id">urn:uuid:test<\/dc:identifier>/);
  assert.match(opf, /<dc:language>en<\/dc:language>/);
  assert.match(opf, /<dc:date>2020-01-01<\/dc:date>/);
  assert.match(opf, /properties="cover-image"/);
  assert.match(opf, /<meta name="cover" content="image-0"\/>/);
  assert.match(opf, /rendition:layout">pre-paginated/);
  assert.match(opf, /page-progression-direction="rtl"/);
  assert.match(opf, /idref="page-0"\/><itemref idref="page-1"/);
  assert.doesNotMatch(opf, /<script>/);
  assert.match(text('EPUB/pages/1.xhtml'), /width=640, height=960/);
  assert.match(text('EPUB/pages/2.xhtml'), /\.\.\/images\/2.jpg/);
  assert.match(text('EPUB/nav.xhtml'), /epub:type="cover" href="pages\/1.xhtml"/);
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
  for (const entry of entries.values()) assert.equal(await crc32(new Blob([entry.bytes])), entry.crc);
});

test('1000 pages are read sequentially and emitted once each', async () => {
  const pages = Array.from({ length: 1000 }, (_, id) => ({ ...scans[0], id }));
  let calls = 0;
  let lastProgress = 0;
  const bytes = await exportBytes(book, pages, async id => {
    assert.equal(id, calls++);
    assert.equal(lastProgress, id);
    return images.get(2);
  }, current => { lastProgress = current; });
  assert.equal(calls, 1000);
  assert.equal(lastProgress, 1000);
  assert.equal(unpack(bytes).size, 2004);
});

test('invalid input fails without silently creating incomplete books', async () => {
  await assert.rejects(exportBytes({ ...book, title: ' ' }), /title/);
  await assert.rejects(exportBytes(book, []), /at least one page/);
  await assert.rejects(exportBytes(book, [{ ...scans[0], type: 'image/heic' }]), /JPEG and PNG/);
  await assert.rejects(exportBytes(book, [{ ...scans[0], width: 0 }]), /dimensions/);
  await assert.rejects(exportBytes(book, scans, () => undefined), /missing or invalid/);
  await assert.rejects(writeEpub(book, scans, id => images.get(id), {
    write() { throw new Error('Disk full'); },
  }), /Disk full/);
});

test('XML strips invalid control characters but preserves international text', () => {
  assert.equal(xml('日本語 📚 \u0000\u0001 & < > "\''), '日本語 📚  &amp; &lt; &gt; &quot;&apos;');
});

test('CRC matches the standard ZIP vector', async () => {
  assert.equal(await crc32(new Blob(['123456789'])), 0xcbf43926);
});

test('ZIP64 directory records handle offsets beyond 4 GiB without allocating a huge file', async () => {
  const chunks = [];
  const writer = new ZipWriter({ write: bytes => chunks.push(bytes) });
  writer.offset = 0x100000000;
  await writer.add('scan.png', 'image');
  const directoryStart = writer.offset;
  chunks.length = 0;
  await writer.finish();
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(42, true), 0xffffffff);
  assert.equal(view.getUint16(30, true), 12);
  assert.equal(view.getBigUint64(46 + 8 + 4, true), 0x100000000n);
  const zip64 = 46 + 8 + 12;
  assert.equal(view.getUint32(zip64, true), 0x06064b50);
  assert.equal(view.getBigUint64(zip64 + 48, true), BigInt(directoryStart));
  assert.equal(view.getUint32(zip64 + 56, true), 0x07064b50);
  assert.equal(view.getUint32(bytes.length - 6, true), 0xffffffff);
});
