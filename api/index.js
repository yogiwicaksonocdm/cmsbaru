const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const PUBLIC_DIR = path.join(__dirname, '../public');

/* ================================================================
 * 1. Inisialisasi Firebase Admin (Firestore)
 *    Di Vercel, kredensial dimasukkan via Environment Variables.
 *    Jika kredensial belum ada, server tetap jalan untuk menyajikan
 *    halaman statis, dan API mengembalikan 503 dengan pesan jelas.
 * ================================================================ */
let db = null;
let firebaseError = null;

if (!admin.apps.length) {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        // Menangani newline pada private key di environment variable
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  } else {
    firebaseError =
      'Kredensial Firebase belum lengkap. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, dan FIREBASE_PRIVATE_KEY.';
  }
}

try {
  if (admin.apps.length) db = admin.firestore();
} catch (error) {
  firebaseError = error.message;
}

// Middleware: tolak request API yang membutuhkan database bila belum siap
function requireDb(req, res, next) {
  if (!db) return res.status(503).json({ error: firebaseError || 'Database belum siap.' });
  next();
}

/* ================================================================
 * 2. Autentikasi admin (token HMAC, tanpa dependensi tambahan)
 *    Login dengan password admin -> token berlaku 8 jam.
 * ================================================================ */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_SECRET = process.env.ADMIN_AUTH_SECRET || ADMIN_PASSWORD;
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 jam

function hmac(value) {
  return crypto
    .createHmac('sha256', AUTH_SECRET || 'cms-insecure-secret')
    .update(String(value))
    .digest('hex');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function issueToken() {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  return { token: `${expiresAt}.${hmac(expiresAt)}`, expiresAt };
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [expiresRaw, signature] = token.split('.');
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  return safeEqual(signature, hmac(expiresAt));
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Tidak terautentikasi. Silakan login kembali.' });
  }
  next();
}

// POST /api/auth/login -> { password } -> { token, expiresAt }
app.post('/api/auth/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res
      .status(503)
      .json({ error: 'ADMIN_PASSWORD belum diatur di environment variables server.' });
  }
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password wajib diisi.' });
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Password salah.' });
  }
  const { token, expiresAt } = issueToken();
  res.json({ token, expiresAt });
});

// GET /api/auth/me -> validasi sesi admin dari sisi dashboard
app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

/* ================================================================
 * 3. Helper normalisasi dokumen post
 * ================================================================ */
function normalizePost(doc) {
  const data = (typeof doc.data === 'function' ? doc.data() : doc) || {};
  return {
    id: doc.id,
    title: data.title || '',
    content: data.content || '',
    author: data.author || 'Admin',
    // Post lama (tanpa field published) tetap dianggap terbit
    published: data.published !== false,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || data.createdAt || null,
  };
}

/* ================================================================
 * 4. API PUBLIK (homepage) — hanya post yang sudah diterbitkan
 * ================================================================ */
app.get('/api/posts', requireDb, async (req, res) => {
  try {
    const snapshot = await db.collection('posts').orderBy('createdAt', 'desc').get();
    const posts = snapshot.docs.map(normalizePost).filter((post) => post.published);
    res.status(200).json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ================================================================
 * 5. API ADMIN — dilindungi token (CRUD penuh)
 * ================================================================ */
app.get('/api/admin/posts', requireDb, requireAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection('posts').orderBy('createdAt', 'desc').get();
    res.status(200).json(snapshot.docs.map(normalizePost));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Membuat konten baru (default berupa draf sampai dipublikasikan)
app.post('/api/posts', requireDb, requireAdmin, async (req, res) => {
  try {
    const { title, content, author, published } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Judul wajib diisi.' });
    }
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'Konten wajib diisi.' });
    }
    const now = new Date().toISOString();
    const newPost = {
      title: String(title).trim(),
      content: String(content).trim(),
      author: (author && String(author).trim()) || 'Admin',
      published: published === true,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await db.collection('posts').add(newPost);
    res.status(201).json({ id: docRef.id, ...newPost });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Memperbarui konten (judul, konten, penulis, status terbit)
app.put('/api/posts/:id', requireDb, requireAdmin, async (req, res) => {
  try {
    const ref = db.collection('posts').doc(req.params.id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return res.status(404).json({ error: 'Postingan tidak ditemukan.' });
    }

    const { title, content, author, published } = req.body || {};
    const patch = { updatedAt: new Date().toISOString() };

    if (title !== undefined) {
      if (!String(title).trim()) return res.status(400).json({ error: 'Judul tidak boleh kosong.' });
      patch.title = String(title).trim();
    }
    if (content !== undefined) {
      if (!String(content).trim()) return res.status(400).json({ error: 'Konten tidak boleh kosong.' });
      patch.content = String(content).trim();
    }
    if (author !== undefined) patch.author = String(author).trim() || 'Admin';
    if (published !== undefined) patch.published = published === true;

    await ref.update(patch);
    const updated = await ref.get();
    res.status(200).json(normalizePost({ id: req.params.id, data: () => updated.data() }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Menghapus konten
app.delete('/api/posts/:id', requireDb, requireAdmin, async (req, res) => {
  try {
    const ref = db.collection('posts').doc(req.params.id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return res.status(404).json({ error: 'Postingan tidak ditemukan.' });
    }
    await ref.delete();
    res.status(200).json({ success: true, id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ================================================================
 * 6. Halaman statis: homepage publik + dashboard admin
 * ================================================================ */
app.use(express.static(PUBLIC_DIR));

// Rute pendek untuk dashboard admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// 404 JSON untuk semua endpoint /api yang tidak dikenal
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
});

// Export untuk Vercel Serverless Function
module.exports = app;

// Jalankan server lokal jika tidak di Vercel
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server CMS berjalan di http://localhost:${PORT}`);
    console.log(`Homepage publik : http://localhost:${PORT}/`);
    console.log(`Dashboard admin : http://localhost:${PORT}/admin`);
    if (!db) console.log(`Perhatian       : ${firebaseError || 'Database belum siap.'}`);
  });
}
