import { ZipWriter } from './zip.js';

export function xml(value = '') {
  return String(value).replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '')
    .replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
    })[character]);
}

function extension(page) {
  if (page.type === 'image/jpeg') return 'jpg';
  if (page.type === 'image/png') return 'png';
  throw new Error('Only JPEG and PNG scans can be exported.');
}

export async function writeEpub(book, pages, readPage, sink, onProgress = () => {}) {
  if (!book.title?.trim()) throw new Error('Enter a book title before exporting.');
  if (!pages.length) throw new Error('Scan at least one page before exporting.');
  for (const page of pages) {
    extension(page);
    if (!Number.isInteger(page.width) || !Number.isInteger(page.height) || page.width < 1 || page.height < 1) {
      throw new Error('A scan has invalid image dimensions.');
    }
  }
  const zip = new ZipWriter(sink);
  const language = xml(book.language || 'en');
  const coverIndex = pages.findIndex(page => page.id === book.coverPageId);
  const optional = ['publisher', 'description', 'rights', 'date']
    .filter(field => book[field])
    .map(field => `<dc:${field}>${xml(book[field])}</dc:${field}>`).join('');
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  await zip.add('mimetype', 'application/epub+zip');
  await zip.add('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  await zip.add('EPUB/package.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${language}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${xml(book.identifier)}</dc:identifier>
<dc:title>${xml(book.title)}</dc:title><dc:language>${language}</dc:language>
${book.author ? `<dc:creator id="author">${xml(book.author)}</dc:creator><meta refines="#author" property="role" scheme="marc:relators">aut</meta>` : ''}
${optional}<meta property="dcterms:modified">${modified}</meta>
<meta property="rendition:layout">pre-paginated</meta>
<meta property="rendition:orientation">auto</meta><meta property="rendition:spread">none</meta>
${coverIndex >= 0 ? `<meta name="cover" content="image-${coverIndex}"/>` : ''}
</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${pages.map((page, index) => `<item id="page-${index}" href="pages/${index + 1}.xhtml" media-type="application/xhtml+xml"/>
<item id="image-${index}" href="images/${index + 1}.${extension(page)}" media-type="${page.type}"${index === coverIndex ? ' properties="cover-image"' : ''}/>`).join('\n')}
</manifest><spine page-progression-direction="${book.direction === 'rtl' ? 'rtl' : 'ltr'}">
${pages.map((_, index) => `<itemref idref="page-${index}"/>`).join('')}
</spine></package>`);
  await zip.add('EPUB/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}">
<head><title>${xml(book.title)}</title></head><body>
<nav epub:type="toc"><h1>Contents</h1><ol>${pages.map((_, index) => `<li><a href="pages/${index + 1}.xhtml">Page ${index + 1}</a></li>`).join('')}</ol></nav>
${coverIndex >= 0 ? `<nav epub:type="landmarks" hidden=""><ol><li><a epub:type="cover" href="pages/${coverIndex + 1}.xhtml">Cover</a></li></ol></nav>` : ''}
</body></html>`);
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const image = await readPage(page.id);
    if (!(image instanceof Blob) || image.type !== page.type) throw new Error(`Scan ${index + 1} is missing or invalid.`);
    await zip.add(`EPUB/images/${index + 1}.${extension(page)}`, image);
    await zip.add(`EPUB/pages/${index + 1}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head><title>Page ${index + 1}</title><meta name="viewport" content="width=${page.width}, height=${page.height}"/>
<style>html,body{margin:0;padding:0;width:${page.width}px;height:${page.height}px}img{display:block;width:100%;height:100%;object-fit:contain}</style></head>
<body><img src="../images/${index + 1}.${extension(page)}" alt="Scanned page ${index + 1}"/></body></html>`);
    onProgress(index + 1, pages.length);
  }
  await zip.finish();
}
