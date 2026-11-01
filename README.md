# Book Converter

A local-first mobile web app for photographing physical books and exporting
image-preserving EPUB 3 books. No account, backend processing, or third-party
services are used. Scans are never uploaded.

## Run

Install Node.js 22 or newer, then run:

```sh
npm start
```

Open `http://localhost:3000`. There are no dependencies to install or build steps.
`HOST` and `PORT` can configure the built-in static development server.
Run tests with `npm test`.

For a phone, serve the `public/` directory through a trusted **HTTPS** static host,
or put an HTTPS reverse proxy in front of the development server. All application
paths are root-relative, so deploy at the origin's root. Do not use plain HTTP on
a LAN: secure browser features require HTTPS (localhost is the development
exception). Open the HTTPS URL in Safari or Chrome and optionally use **Add to
Home Screen** / **Install app**. Once loaded, the app can work offline on browsers
supporting service workers. A camera-equipped physical phone is required to
verify actual capture.

## Scan a book

1. Enter the title, author, language, and any additional metadata; save details.
2. Tap **Take photo** to open the phone's rear camera, or **Import images** to
   select existing JPEG/PNG scans. Files are appended in the order supplied by
   the file picker. Capture one complete page per image, in good light, with the
   page flat and the camera parallel to it.
3. Scan the cover too. The first scan is the cover by default; **Use as cover**
   can select another scan. The cover stays in its chosen reading-order position.
4. Review the paginated previews, move pages earlier/later, or delete bad scans
   and import replacements. Details and each completed scan are saved in
   IndexedDB, so you can close the app and continue later on the same device,
   browser, and site address. Save details before closing.
5. **Export EPUB**, then open the downloaded `.epub` in Apple Books. On iPhone,
   use the download's share sheet or **Share last EPUB** and choose Books.
   Direct-to-disk exports can be shared from the operating system's file manager.
6. **Download metadata JSON** exports the book details separately for sharing.
   The EPUB contains the selected cover image and standard title, author,
   language, identifier (ISBN or generated URN), publisher, description,
   publication date, and rights metadata for library apps.

**Start a new book** deletes the current local book after confirmation. Keep an
exported backup first. This app keeps one active book per browser origin; use
only one tab at a time (supported browsers enforce this with Web Locks).

## Fidelity and long books

- EPUB pages are **fixed-layout images**, not OCR text. Original JPEG/PNG bytes
  are embedded unchanged; illustrations, typography, colors, and page layout
  are preserved at the captured resolution. No automatic cropping, deskew,
  enhancement, or lossy re-encoding of the original scans is performed. Small
  preview thumbnails are generated separately for mobile memory efficiency. Physical capture quality
  determines fidelity; this is not a guarantee of a perfect reproduction of
  the physical original. Text is not searchable, selectable, or reflowable.
- HEIC and other formats must be converted to JPEG/PNG before importing.
  A two-page photograph remains one EPUB page. Capture individual pages if
  separate page navigation is needed.
- There is no imposed page-count limit. Only 12 previews are displayed at once,
  and export reads one stored image at a time, respecting output backpressure.
  ZIP64 offsets are emitted when needed for archives larger than 4 GiB.
  Each individual image must be under 4 GiB. Automated tests cover 1,000 pages.
- Browsers offering `showSaveFilePicker` (typically desktop Chrome/Edge over
  HTTPS) stream exports directly to disk, without retaining the whole EPUB in
  app memory. Other browsers, including iPhone Safari, assemble the final
  download in a Blob; large books can exceed available memory. The app warns
  before fallback exports over 250 MiB. For a 1,000-page book, available device
  storage and image sizes matter; test export early with representative scans.
  Scans stored on a phone do not automatically appear on a desktop.
- Browser quotas vary, and private browsing, clearing site data, or eviction
  can remove local scans. **Protect local storage** requests persistence, but
  the browser may decline. Export backups regularly. Export failures do not
  delete saved scans; a failed import keeps all scans already committed.
- Fixed-layout EPUB 3 and cover metadata target Apple Books and compatible
  readers. Actual Apple Books import, camera capture, and very large ZIP64
  books should be checked on your target device; they are not verified by the
  automated tests.

Only reproduce and share books you have permission to copy.