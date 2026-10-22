const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const PUBLIC_DIR = path.join(__dirname, '../public');

let db = null;
let firebaseError = null;

if (!admin.apps.length) {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  } else {
    firebaseError = 'Kredensial Firebase belum lengkap. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, dan FIREBASE_PRIVATE_KEY.';
  }
}

try {
  if (admin.apps.length) db = admin.firestore();
} catch (error) {
  firebaseError = error.message;
}

function requireDb(req, res, next) {
  if (!db) return res.status(503).json({ error: firebaseError || 'Database belum siap.' });
  next();
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_SECRET = process.env.ADMIN_AUTH_SECRET || ADMIN_PASSWORD;
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

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

app.post('/api/auth/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD belum diatur di environment variables server.' });
  }
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password wajib diisi.' });
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Password salah.' });
  }
  const { token, expiresAt } = issueToken();
  res.json({ token, expiresAt });
});

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

function normalizePost(doc) {
  const data = (typeof doc.data === 'function' ? doc.data() : doc) || {};
  return {
    id: doc.id,
    title: data.title || '',
    content: data.content || '',
    author: data.author || 'Admin',
    category: String(data.category || 'Umum').trim() || 'Umum',
    image: String(data.image || '').trim(),
    thumbnail: String(data.thumbnail || '').trim(),
    published: data.published !== false,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || data.createdAt || null,
  };
}

function normalizeComment(doc) {
  const data = (typeof doc.data === 'function' ? doc.data() : doc) || {};
  return {
    id: doc.id,
    postId: data.postId || '',
    name: String(data.name || 'Pengguna').trim() || 'Pengguna',
    content: String(data.content || '').trim(),
    status: data.status || 'pending',
    createdAt: data.createdAt || null,
  };
}

app.get('/api/posts', requireDb, async (req, res) => {
  try {
    const snapshot = await db.collection('posts').orderBy('createdAt', 'desc').get();
    const posts = snapshot.docs.map(normalizePost).filter((post) => post.published);
    res.status(200).json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/posts/:id/comments', requireDb, async (req, res) => {
  try {
    // Satu equality filter + pengurutan di sisi aplikasi
    // agar tidak butuh composite index Firestore (postId, status, createdAt).
    const snapshot = await db.collection('comments')
      .where('postId', '==', req.params.id)
      .get();
    const comments = snapshot.docs
      .map(normalizeComment)
      .filter((c) => c.status === 'approved')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.status(200).json(comments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/posts/:id/comments', requireDb, async (req, res) => {
  try {
    const { name, content } = req.body || {};
    const postRef = db.collection('posts').doc(req.params.id);
    const postSnap = await postRef.get();
    if (!postSnap.exists) {
      return res.status(404).json({ error: 'Postingan tidak ditemukan.' });
    }

    const safeName = String(name || '').trim();
    const safeContent = String(content || '').trim();

    if (!safeName || safeName.length < 2) {
      return res.status(400).json({ error: 'Nama tidak boleh kosong dan minimal 2 karakter.' });
    }
    if (!safeContent || safeContent.length < 3) {
      return res.status(400).json({ error: 'Komentar terlalu pendek.' });
    }
    if (safeContent.length > 1000) {
      return res.status(400).json({ error: 'Komentar maksimal 1000 karakter.' });
    }

    const now = new Date().toISOString();
    const comment = {
      postId: req.params.id,
      name: safeName,
      content: safeContent,
      status: 'pending',
      createdAt: now,
    };

    const docRef = await db.collection('comments').add(comment);
    res.status(201).json({ id: docRef.id, ...comment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/posts', requireDb, requireAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection('posts').orderBy('createdAt', 'desc').get();
    res.status(200).json(snapshot.docs.map(normalizePost));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/comments', requireDb, requireAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection('comments').orderBy('createdAt', 'desc').get();
    res.status(200).json(snapshot.docs.map(normalizeComment));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/comments/:id', requireDb, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body || {};
    const valid = ['approved', 'rejected', 'pending'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: 'Status komentar tidak valid.' });
    }

    const ref = db.collection('comments').doc(req.params.id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return res.status(404).json({ error: 'Komentar tidak ditemukan.' });
    }

    await ref.update({ status });
    const updated = await ref.get();
    res.status(200).json(normalizeComment({ id: req.params.id, data: () => updated.data() }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/posts', requireDb, requireAdmin, async (req, res) => {
  try {
    const { title, content, author, category, published, image, thumbnail } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Judul wajib diisi.' });
    }
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'Konten wajib diisi.' });
    }
    const imageUrl = typeof image === 'string' ? image.trim() : '';
    const thumbnailUrl = typeof thumbnail === 'string' ? thumbnail.trim() : '';
    if (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl)) {
      return res.status(400).json({ error: 'URL gambar utama tidak valid.' });
    }
    if (thumbnailUrl && !/^https?:\/\/\S+$/i.test(thumbnailUrl)) {
      return res.status(400).json({ error: 'URL thumbnail tidak valid.' });
    }
    const now = new Date().toISOString();
    const newPost = {
      title: String(title).trim(),
      content: String(content).trim(),
      author: (author && String(author).trim()) || 'Admin',
      category: (category && String(category).trim().slice(0, 40)) || 'Umum',
      image: imageUrl,
      thumbnail: thumbnailUrl,
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

app.put('/api/posts/:id', requireDb, requireAdmin, async (req, res) => {
  try {
    const ref = db.collection('posts').doc(req.params.id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return res.status(404).json({ error: 'Postingan tidak ditemukan.' });
    }

    const { title, content, author, category, published, image, thumbnail } = req.body || {};
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
    if (category !== undefined) patch.category = String(category).trim().slice(0, 40) || 'Umum';
    if (image !== undefined) {
      const imageUrl = String(image || '').trim();
      if (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl)) {
        return res.status(400).json({ error: 'URL gambar utama tidak valid.' });
      }
      patch.image = imageUrl;
    }
    if (thumbnail !== undefined) {
      const thumbUrl = String(thumbnail || '').trim();
      if (thumbUrl && !/^https?:\/\/\S+$/i.test(thumbUrl)) {
        return res.status(400).json({ error: 'URL thumbnail tidak valid.' });
      }
      patch.thumbnail = thumbUrl;
    }
    if (published !== undefined) patch.published = published === true;

    await ref.update(patch);
    const updated = await ref.get();
    res.status(200).json(normalizePost({ id: req.params.id, data: () => updated.data() }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function generatePostMedia({ title, category, keywords }) {
  const seed = hashString(`${title || 'post'}|${category || 'Umum'}|${keywords || ''}`);
  const photoIds = [
    'photo-1493246507139-91e8fad9978e',
    'photo-1500530855697-b586d89ba3ee',
    'photo-1516321318423-f06f85e504b3',
    'photo-1522202176988-66273c2fd55f',
    'photo-1524758631624-e2822e304c36',
    'photo-1518770660439-4636190af475',
    'photo-1504384308090-c894fdcc538d',
    'photo-1487412720507-e7ab37603c6f',
  ];
  const photoId = photoIds[seed % photoIds.length];
  const base = `https://images.unsplash.com/${photoId}?auto=format&fit=crop`;
  return {
    picture: `${base}&w=1200&q=80`,
    thumbnail: `${base}&w=600&h=360&q=80`,
  };
}

app.post('/api/posts/generate-media', requireAdmin, async (req, res) => {
  try {
    const { title, category, keywords } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Isi judul terlebih dahulu sebelum generate gambar.' });
    }
    const media = generatePostMedia({
      title: String(title).trim(),
      category: String(category || '').trim(),
      keywords: String(keywords || '').trim(),
    });
    res.status(200).json(media);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

function generateContentTemplate({ title, category, keywords }) {
  const kataKunci = String(keywords || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const topik = kataKunci.length ? kataKunci.join(', ') : title;
  const bidang = category || 'Umum';

  return [
    `## Latar Belakang`,
    `Topik "${title}" semakin relevan dalam konteks ${bidang.toLowerCase()}. Bagian ini mengulas mengapa topik tersebut penting dan apa yang akan Anda dapatkan setelah membaca artikel ini sampai tuntas.`,
    '',
    '## Poin Utama',
    `1. ${topik} — penjelasan mendalam beserta contoh penerapannya.`,
    `2. Manfaat dan tantangan saat mengimplementasikan ${title.toLowerCase()}.`,
    '3. Langkah praktis yang bisa langsung diterapkan pembaca.',
    '',
    '## Tips Praktis',
    `Mulailah dari hal paling sederhana: tentukan tujuan yang jelas saat membahas ${title.toLowerCase()}, siapkan data pendukung, lalu sajikan informasi secara bertahap agar mudah dipahami pembaca.`,
    '',
    '## Penutup',
    `Demikian ulasan mengenai ${title}. Semoga informasi ini bermanfaat dan bisa langsung Anda praktikkan.`,
  ].join('\n');
}

async function generateContentWithAI({ title, category, keywords }) {
  const systemPrompt = 'Anda adalah penulis artikel blog profesional berbahasa Indonesia. Tulis konten informatif yang terstruktur dengan heading Markdown (##), tanpa salam pembuka. Keluarkan hanya isi artikel.';
  const userPrompt = `Tulis artikel blog tentang "${title}".\nKategori: ${category || 'Umum'}.\nKata kunci (opsional): ${keywords || '-'}.\nPanjang 400-700 kata, gunakan heading Markdown, paragraf yang jelas, dan tambahkan satu tag <!-- pagebreak --> untuk membagi konten bila perlu.`;

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`API AI merespons dengan status ${response.status}`);
  const data = await response.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content || !String(content).trim()) throw new Error('API AI tidak mengembalikan konten');
  return String(content).trim();
}

app.post('/api/posts/generate', requireAdmin, async (req, res) => {
  const { title, category, keywords } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'Isi judul terlebih dahulu sebelum generate konten.' });
  }
  const params = {
    title: String(title).trim(),
    category: String(category || '').trim(),
    keywords: String(keywords || '').trim(),
  };

  if (AI_API_KEY) {
    try {
      const content = await generateContentWithAI(params);
      return res.status(200).json({ content, source: 'ai' });
    } catch (error) {
      return res.status(200).json({
        content: generateContentTemplate(params),
        source: 'template',
        warning: `AI gagal (${error.message}); memakai template otomatis.`,
      });
    }
  }
  res.status(200).json({ content: generateContentTemplate(params), source: 'template' });
});

const DEFAULT_SETTINGS = {
  hero: {
    title: 'Selamat Datang di CMS Kami',
    subtitle: 'Baca semua konten yang sudah diterbitkan oleh tim admin. Konten diperbarui secara langsung dari Firestore.',
    image: '',
  },
};

const settingsRef = () => db.collection('settings').doc('site');

function normalizeSettings(doc) {
  const data = (typeof doc.data === 'function' ? doc.data() : doc) || {};
  const hero = data.hero || {};
  return {
    hero: {
      title: String(hero.title || DEFAULT_SETTINGS.hero.title).trim(),
      subtitle: String(hero.subtitle || DEFAULT_SETTINGS.hero.subtitle).trim(),
      image: String(hero.image || '').trim(),
    },
    updatedAt: data.updatedAt || null,
  };
}

app.get('/api/settings', requireDb, async (req, res) => {
  try {
    const snapshot = await settingsRef().get();
    if (!snapshot.exists) return res.status(200).json(DEFAULT_SETTINGS);
    res.status(200).json(normalizeSettings(snapshot));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/settings', requireDb, requireAdmin, async (req, res) => {
  try {
    const hero = (req.body || {}).hero || {};
    const title = hero.title !== undefined ? String(hero.title).trim() : null;
    const subtitle = hero.subtitle !== undefined ? String(hero.subtitle).trim() : null;
    const image = hero.image !== undefined ? String(hero.image).trim() : null;

    if (title !== null) {
      if (!title) return res.status(400).json({ error: 'Judul hero tidak boleh kosong.' });
      if (title.length > 120) return res.status(400).json({ error: 'Judul hero maksimal 120 karakter.' });
    }
    if (subtitle !== null && subtitle.length > 300) {
      return res.status(400).json({ error: 'Teks pendukung hero maksimal 300 karakter.' });
    }
    if (image !== null && image && !/^https?:\/\/\S+$/i.test(image)) {
      return res.status(400).json({ error: 'URL background tidak valid (harus diawali http:// atau https://).' });
    }

    const snapshot = await settingsRef().get();
    const current = snapshot.exists ? normalizeSettings(snapshot) : DEFAULT_SETTINGS;
    const next = {
      hero: {
        title: title !== null ? title : current.hero.title,
        subtitle: subtitle !== null ? subtitle : current.hero.subtitle,
        image: image !== null ? image : current.hero.image,
      },
      updatedAt: new Date().toISOString(),
    };
    await settingsRef().set(next);
    res.status(200).json(next);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use(express.static(PUBLIC_DIR));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server CMS berjalan di http://localhost:${PORT}`);
    console.log(`Homepage publik : http://localhost:${PORT}/`);
    console.log(`Dashboard admin : http://localhost:${PORT}/admin`);
    if (!db) console.log(`Perhatian       : ${firebaseError || 'Database belum siap.'}`);
  });
}
