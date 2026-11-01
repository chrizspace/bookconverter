import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../server.js';

test('server serves app assets but never exposes repository files', async () => {
  const server = makeServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /object-src 'none'/);
    assert.match(await response.text(), /capture="environment"/);
    for (const path of ['/app.js', '/storage.js', '/zip.js', '/epub.js', '/styles.css', '/sw.js', '/manifest.webmanifest', '/icon.svg']) {
      assert.equal((await fetch(base + path)).status, 200, path);
    }
    for (const path of ['/package.json', '/.git/config', '/server.js', '/%2e%2e/package.json']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    assert.equal((await fetch(base, { method: 'POST' })).status, 404);
    assert.equal(await (await fetch(base, { method: 'HEAD' })).text(), '');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
