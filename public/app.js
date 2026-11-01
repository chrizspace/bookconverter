import * as storage from './storage.js';
import { writeEpub } from './epub.js';

const $ = id => document.getElementById(id);
const fields = ['title', 'author', 'language', 'direction', 'publisher', 'date', 'identifier', 'description', 'rights'];
const batchSize = 12;
let book;
let offset = 0;
let previewUrls = [];
let lastExport;
let busy = false;

function newBook() {
  return {
    title: '', author: '', language: 'en', direction: 'ltr', publisher: '',
    date: '', identifier: `urn:uuid:${crypto.randomUUID()}`, description: '', rights: '',
    pages: [], coverPageId: null,
  };
}

function status(message) {
  $('status').textContent = message;
}

function setBusy(value) {
  busy = value;
  $('workspace').disabled = value;
  $('progress').hidden = !value;
  if (value) $('progress').removeAttribute('value');
  $('share').disabled = !lastExport || !navigator.share;
}

function invalidateExport() {
  lastExport = undefined;
  $('share').disabled = true;
}

async function perform(action) {
  if (busy) return;
  setBusy(true);
  try {
    const message = await action();
    if (message) status(message);
  } catch (error) {
    status(error.name === 'QuotaExceededError'
      ? 'Device storage is full. Previously saved scans are safe. Export a backup before freeing storage.'
      : `${error.message} Any scans already saved have been kept.`);
  } finally {
    setBusy(false);
  }
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text, action, disabled = false) {
  const element = node('button', text);
  element.type = 'button';
  element.disabled = disabled;
  element.addEventListener('click', () => perform(action));
  return element;
}

async function renderPages() {
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls = [];
  $('pages').replaceChildren();
  offset = Math.max(0, Math.min(offset, Math.floor(Math.max(0, book.pages.length - 1) / batchSize) * batchSize));
  const totalBytes = book.pages.reduce((sum, page) => sum + page.size, 0);
  $('summary').textContent = `${book.pages.length} scans · ${(totalBytes / 1024 / 1024).toFixed(1)} MiB stored on this device`;
  $('range').textContent = book.pages.length ? `${offset + 1}–${Math.min(offset + batchSize, book.pages.length)} of ${book.pages.length}` : 'No scans yet';
  $('previous').disabled = offset === 0;
  $('next').disabled = offset + batchSize >= book.pages.length;
  for (let index = offset; index < Math.min(offset + batchSize, book.pages.length); index++) {
    const page = book.pages[index];
    const card = node('article', '', 'page');
    card.append(node('h3', `Page ${index + 1}${page.id === book.coverPageId ? ' · Cover' : ''}`));
    const image = node('img');
    image.alt = `Preview of scanned page ${index + 1}`;
    const blob = await storage.readPreview(page.id);
    if (blob) {
      const url = URL.createObjectURL(blob);
      previewUrls.push(url);
      image.src = url;
    }
    card.append(image);
    const actions = node('div', '', 'actions');
    actions.append(
      button('Move earlier', () => movePage(index, -1), index === 0),
      button('Move later', () => movePage(index, 1), index === book.pages.length - 1),
      button('Use as cover', async () => {
        const updated = { ...book, coverPageId: page.id };
        await storage.saveBook(updated);
        book = updated;
        invalidateExport();
        await renderPages();
        return 'Cover updated.';
      }, page.id === book.coverPageId),
      button('Delete', async () => {
        if (!confirm(`Delete page ${index + 1}? This cannot be undone.`)) return;
        book = await storage.deletePage(book, page.id);
        invalidateExport();
        await renderPages();
        return 'Page deleted.';
      }),
    );
    card.append(actions);
    $('pages').append(card);
  }
}

async function movePage(index, delta) {
  const pages = [...book.pages];
  [pages[index], pages[index + delta]] = [pages[index + delta], pages[index]];
  const updated = { ...book, pages };
  await storage.saveBook(updated);
  book = updated;
  invalidateExport();
  offset = Math.floor((index + delta) / batchSize) * batchSize;
  await renderPages();
  return 'Page order saved.';
}

async function saveDetails() {
  const values = Object.fromEntries(fields.map(field => [field, $('metadata').elements.namedItem(field).value.trim()]));
  const updated = { ...book, ...values };
  await storage.saveBook(updated);
  book = updated;
  invalidateExport();
}

async function inspectImage(file) {
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  const type = png.every((byte, index) => signature[index] === byte) ? 'image/png'
    : signature[0] === 255 && signature[1] === 216 && signature[2] === 255 ? 'image/jpeg' : null;
  if (!type) throw new Error(`${file.name}: use JPEG or PNG images (convert HEIC first).`);
  const blob = file.slice(0, file.size, type);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const preview = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    return { blob, preview, page: { width: image.naturalWidth, height: image.naturalHeight, type, size: blob.size } };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function importFiles(input) {
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  invalidateExport();
  try {
    for (let index = 0; index < files.length; index++) {
      status(`Saving scan ${index + 1} of ${files.length}…`);
      const { page, blob, preview } = await inspectImage(files[index]);
      book = await storage.addPage(book, page, blob, preview);
      $('progress').max = files.length;
      $('progress').value = index + 1;
    }
  } finally {
    offset = Math.floor(Math.max(0, book.pages.length - 1) / batchSize) * batchSize;
    await renderPages();
  }
  return `${files.length} scans saved. You can close the app and resume later.`;
}

function filename(extension) {
  return `${(book.title || 'book').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 100) || 'book'}.${extension}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = node('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportBook() {
  if (!$('metadata').reportValidity()) return;
  if (!book.pages.length) throw new Error('Scan at least one page before exporting.');
  // Open the picker before awaiting storage to retain the user's activation.
  let target;
  if (window.showSaveFilePicker) {
    try {
      target = await window.showSaveFilePicker({
        suggestedName: `${$('metadata').elements.namedItem('title').value.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 100) || 'book'}.epub`,
        types: [{ description: 'EPUB book', accept: { 'application/epub+zip': ['.epub'] } }],
      });
    } catch (error) {
      if (error.name === 'AbortError') return 'Export cancelled.';
      throw error;
    }
  } else {
    const size = book.pages.reduce((sum, page) => sum + page.size, 0);
    if (size > 250 * 1024 * 1024 && !confirm('This browser must prepare the complete EPUB download. Large books may exceed device memory. Continue? For streamed export, open this app in a browser with direct file-save support.')) return 'Export cancelled.';
  }
  await saveDetails();
  const chunks = [];
  const sink = target ? await target.createWritable() : { write: chunk => { chunks.push(chunk); } };
  try {
    await writeEpub(book, book.pages, storage.readImage, sink, (current, total) => {
      status(`Exporting page ${current} of ${total}…`);
      $('progress').max = total;
      $('progress').value = current;
    });
    if (target) {
      await sink.close();
      return 'EPUB saved. Open the file in Apple Books, or share it using your file manager.';
    }
    lastExport = new File(chunks, filename('epub'), { type: 'application/epub+zip' });
    download(lastExport, lastExport.name);
    return 'EPUB ready. Open the download in Apple Books or use “Share last EPUB”.';
  } catch (error) {
    if (target) await sink.abort().catch(() => {});
    throw error;
  } finally {
    chunks.length = 0;
  }
}

function populateDetails() {
  for (const field of fields) $('metadata').elements.namedItem(field).value = book[field] || '';
}

async function initialize() {
  await storage.openDatabase();
  book = await storage.loadBook();
  if (!book) {
    book = newBook();
    await storage.saveBook(book);
  }
  populateDetails();
  await renderPages();
  setBusy(false);
  status('Ready. Your scans stay on this device. Export regularly to keep a backup.');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

$('metadata').addEventListener('submit', event => {
  event.preventDefault();
  perform(async () => { await saveDetails(); return 'Book details saved.'; });
});
$('metadata').addEventListener('input', invalidateExport);
for (const id of ['camera', 'import']) $(id).addEventListener('change', () => perform(() => importFiles($(id))));
$('previous').addEventListener('click', () => perform(async () => { offset -= batchSize; await renderPages(); }));
$('next').addEventListener('click', () => perform(async () => { offset += batchSize; await renderPages(); }));
$('export').addEventListener('click', () => perform(exportBook));
$('share').addEventListener('click', () => perform(async () => {
  if (!lastExport || !navigator.canShare?.({ files: [lastExport] })) return 'File sharing is unavailable. Share the downloaded EPUB from your file manager.';
  try {
    await navigator.share({ files: [lastExport], title: book.title });
    return 'EPUB shared.';
  } catch (error) {
    if (error.name === 'AbortError') return 'Sharing cancelled.';
    throw error;
  }
}));
$('export-metadata').addEventListener('click', () => perform(async () => {
  if (!$('metadata').reportValidity()) return;
  await saveDetails();
  const metadata = Object.fromEntries(fields.map(field => [field, book[field]]));
  metadata.coverPage = book.pages.findIndex(page => page.id === book.coverPageId) + 1 || null;
  metadata.pageCount = book.pages.length;
  download(new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }), filename('json'));
  return 'Metadata downloaded. The cover image is included in the EPUB.';
}));
$('storage').addEventListener('click', () => perform(async () => {
  if (!navigator.storage?.persist) return 'Persistent storage is unavailable. Export backups regularly.';
  return await navigator.storage.persist()
    ? 'Persistent storage granted. Still keep exported backups.'
    : 'The browser did not grant persistent storage. Keep exported backups.';
}));
$('new-book').addEventListener('click', () => perform(async () => {
  if (!confirm('Delete all local scans and details to start a new book? Export a backup first. This cannot be undone.')) return;
  const updated = newBook();
  await storage.clearBook(updated);
  book = updated;
  invalidateExport();
  populateDetails();
  offset = 0;
  await renderPages();
  return 'New book ready.';
}));

function initializationError(error) {
  $('workspace').disabled = true;
  status(`Unable to open local storage: ${error.message}. Use a browser with IndexedDB enabled and open this app over HTTPS (or localhost).`);
}

if (navigator.locks) {
  navigator.locks.request('bookconverter-workspace', { ifAvailable: true }, async lock => {
    if (!lock) {
      status('This book is already open in another tab. Close that tab, then reload here.');
      return;
    }
    await initialize();
    await new Promise(() => {});
  }).catch(initializationError);
} else {
  initialize().catch(initializationError);
}
