/**
 * Smoke test end-to-end untuk CMS:
 *  - homepage publik & dashboard admin tersaji
 *  - endpoint admin terproteksi token
 *  - CRUD + publish/unpublish post via API (Firestore di-mock in-memory)
 *
 * Jalankan: npm test
 */
process.env.NODE_ENV = 'production'; // cegah app.listen() otomatis
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'rahasia123';
delete process.env.AI_API_KEY; // pastikan jalur template yang teruji (deterministik)
// Kredensial demo: hanya untuk memicu inisialisasi; Firestore di-mock in-memory
process.env.FIREBASE_PROJECT_ID = 'demo-project';
process.env.FIREBASE_CLIENT_EMAIL = 'demo@example.com';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ndemo\n-----END PRIVATE KEY-----';

require('./mock-firebase').install();

const http = require('http');
const assert = require('assert');
const app = require('../api/index');

const server = http.createServer(app);

async function request(method, path, { body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* halaman HTML */ }
  return { status: res.status, text, json };
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // 1. Halaman statis
  let res = await request('GET', '/');
  assert.strictEqual(res.status, 200, 'GET / harus 200');
  assert.ok(res.text.includes('Selamat Datang'), 'homepage harus berisi hero');
  assert.ok(res.text.includes('Masuk Admin'), 'homepage harus punya link ke admin');
  console.log('✓ GET / tersaji (homepage publik)');

  res = await request('GET', '/admin');
  assert.strictEqual(res.status, 200, 'GET /admin harus 200');
  assert.ok(res.text.includes('Dashboard Admin'), 'dashboard harus berisi judul admin');
  console.log('✓ GET /admin tersaji (dashboard admin)');

  // 2. API admin terproteksi
  res = await request('GET', '/api/admin/posts');
  assert.strictEqual(res.status, 401, 'GET /api/admin/posts tanpa token harus 401');
  res = await request('POST', '/api/posts', { body: { title: 'X', content: 'Y' } });
  assert.strictEqual(res.status, 401, 'POST /api/posts tanpa token harus 401');
  res = await request('PUT', '/api/posts/abc', { body: { title: 'X' }, token: 'garbage.token' });
  assert.strictEqual(res.status, 401, 'token palsu harus 401');
  console.log('✓ endpoint admin terproteksi (401 tanpa token valid)');

  // 3. Login
  res = await request('POST', '/api/auth/login', { body: { password: 'salah' } });
  assert.strictEqual(res.status, 401, 'password salah harus 401');
  res = await request('POST', '/api/auth/login', { body: { password: process.env.ADMIN_PASSWORD } });
  assert.strictEqual(res.status, 200, 'login benar harus 200');
  const { token } = res.json;
  assert.ok(token && token.includes('.'), 'login harus mengembalikan token');
  console.log('✓ POST /api/auth/login (token diterbitkan)');

  res = await request('GET', '/api/auth/me', { token });
  assert.strictEqual(res.status, 200, 'token valid harus lolos /api/auth/me');
  console.log('✓ GET /api/auth/me (sesi valid)');

  // 4. Validasi input
  res = await request('POST', '/api/posts', { body: { title: '', content: '' }, token });
  assert.strictEqual(res.status, 400, 'post kosong harus 400');
  console.log('✓ validasi input post (400)');

  // 4b. Generate konten otomatis (tanpa AI_API_KEY -> template)
  res = await request('POST', '/api/posts/generate', { body: { title: 'X' } });
  assert.strictEqual(res.status, 401, 'generate tanpa token harus 401');
  res = await request('POST', '/api/posts/generate', { body: {}, token });
  assert.strictEqual(res.status, 400, 'generate tanpa judul harus 400');
  res = await request('POST', '/api/posts/generate', {
    body: { title: 'Cara Belajar Node.js', category: 'Teknologi' },
    token,
  });
  assert.strictEqual(res.status, 200, 'generate dengan token harus 200');
  assert.ok(res.json.content && res.json.content.length > 100, 'konten hasil generate harus substansial');
  assert.ok(res.json.content.includes('Node.js'), 'konten generate harus memuat judul');
  assert.strictEqual(res.json.source, 'template', 'tanpa AI_API_KEY harus memakai template');
  console.log('✓ generate konten otomatis (endpoint admin + template fallback)');

  // 4c. Pengaturan hero
  res = await request('GET', '/api/settings');
  assert.strictEqual(res.status, 200, 'GET /api/settings publik harus 200');
  assert.ok(res.json.hero && res.json.hero.title, 'settings harus punya hero.title');
  res = await request('PUT', '/api/settings', { body: { hero: { title: 'Judul Baru Hero' } }, token });
  assert.strictEqual(res.status, 200, 'PUT settings harus 200');
  assert.strictEqual(res.json.hero.title, 'Judul Baru Hero');
  res = await request('GET', '/api/settings');
  assert.strictEqual(res.json.hero.title, 'Judul Baru Hero', 'perubahan hero harus tersimpan');
  res = await request('PUT', '/api/settings', { body: { hero: { image: 'ftp://tidak-valid' } }, token });
  assert.strictEqual(res.status, 400, 'URL gambar tidak valid harus 400');
  console.log('✓ pengaturan hero (publik GET / admin PUT / validasi)');

  // 5. CRUD: buat draf -> tidak tampil di publik -> terbit -> tampil -> hapus
  res = await request('POST', '/api/posts', {
    body: { title: 'Post Pertama', content: 'Isi konten pertama.', author: 'Buffy', category: 'Teknologi', published: false },
    token,
  });
  assert.strictEqual(res.status, 201, 'create post harus 201');
  assert.strictEqual(res.json.category, 'Teknologi', 'kategori post harus tersimpan');
  const postId = res.json.id;

  res = await request('GET', '/api/posts');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.length, 0, 'draf tidak boleh tampil di homepage');
  console.log('✓ draf tersembunyi dari GET /api/posts');

  res = await request('PUT', `/api/posts/${postId}`, { body: { published: true }, token });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.published, true, 'post harus menjadi terbit');

  res = await request('GET', '/api/posts');
  assert.strictEqual(res.json.length, 1, 'post terbit harus tampil di homepage');
  assert.strictEqual(res.json[0].title, 'Post Pertama');
  assert.strictEqual(res.json[0].category, 'Teknologi', 'kategori harus ikut di endpoint publik');
  console.log('✓ publish post -> tampil di homepage publik');

  res = await request('GET', '/api/admin/posts', { token });
  assert.strictEqual(res.json.length, 1, 'dashboard harus melihat semua post');
  console.log('✓ GET /api/admin/posts (daftar lengkap)');

  res = await request('DELETE', `/api/posts/${postId}`, { token });
  assert.strictEqual(res.status, 200);
  res = await request('GET', '/api/posts');
  assert.strictEqual(res.json.length, 0, 'post terhapus tidak boleh tampil');
  res = await request('DELETE', `/api/posts/${postId}`, { token });
  assert.strictEqual(res.status, 404, 'hapus dua kali harus 404');
  console.log('✓ DELETE post (dan 404 untuk id yang sudah hilang)');

  // 5b. Kategori default 'Umum' bila tidak diisi
  res = await request('POST', '/api/posts', { body: { title: 'Tanpa Kategori', content: 'Isi.' }, token });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.json.category, 'Umum', 'kategori kosong harus default Umum');
  await request('DELETE', `/api/posts/${res.json.id}`, { token });
  console.log('✓ kategori default Umum');

  // 6. 404 API
  res = await request('GET', '/api/tidak-ada');
  assert.strictEqual(res.status, 404);
  console.log('✓ 404 untuk endpoint API yang tidak dikenal');

  console.log(`\nSemua smoke test lulus ✅ (${base})`);
}

main()
  .catch((error) => {
    console.error('\nSmoke test GAGAL:', error.message);
    process.exitCode = 1;
  })
  .finally(() => server.close());
