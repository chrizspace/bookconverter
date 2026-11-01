let database;

export async function openDatabase() {
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('bookconverter', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('book');
      request.result.createObjectStore('pages', { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Book Converter tabs and try again.'));
  });
  database.onversionchange = () => database.close();
}

function transaction(stores, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Unable to save scans.'));
    action(tx, value => { result = value; });
  });
}

export function loadBook() {
  return transaction(['book'], 'readonly', (tx, done) => {
    tx.objectStore('book').get('current').onsuccess = event => done(event.target.result);
  });
}

export function saveBook(book) {
  return transaction(['book'], 'readwrite', tx => tx.objectStore('book').put(book, 'current'));
}

export function readImage(id) {
  return transaction(['pages'], 'readonly', (tx, done) => {
    tx.objectStore('pages').get(id).onsuccess = event => done(event.target.result?.blob);
  });
}

export function readPreview(id) {
  return transaction(['pages'], 'readonly', (tx, done) => {
    tx.objectStore('pages').get(id).onsuccess = event => {
      const record = event.target.result;
      done(record?.preview || record?.blob);
    };
  });
}

export function addPage(book, page, blob, preview) {
  return transaction(['pages', 'book'], 'readwrite', (tx, done) => {
    tx.objectStore('pages').add({ blob, preview }).onsuccess = event => {
      const id = event.target.result;
      const updated = { ...book, pages: [...book.pages, { ...page, id }] };
      if (updated.coverPageId == null) updated.coverPageId = id;
      tx.objectStore('book').put(updated, 'current');
      done(updated);
    };
  });
}

export function deletePage(book, id) {
  const updated = { ...book, pages: book.pages.filter(page => page.id !== id) };
  if (updated.coverPageId === id) updated.coverPageId = updated.pages[0]?.id ?? null;
  return transaction(['pages', 'book'], 'readwrite', (tx, done) => {
    tx.objectStore('pages').delete(id);
    tx.objectStore('book').put(updated, 'current');
    done(updated);
  });
}

export function clearBook(book) {
  return transaction(['pages', 'book'], 'readwrite', tx => {
    tx.objectStore('pages').clear();
    tx.objectStore('book').put(book, 'current');
  });
}
