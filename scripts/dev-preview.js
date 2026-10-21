/**
 * Server pengembangan lokal untuk preview CMS.
 *
 * - Jika kredensial Firebase sudah di-set di .env, memakai Firestore sungguhan.
 * - Jika belum, otomatis memakai Firestore in-memory (mock) agar halaman
 *   bisa dicoba langsung tanpa konfigurasi (data hilang saat server berhenti).
 *
 * Jalankan: npm run preview
 */
require('dotenv').config();

const hasFirebaseCreds = Boolean(
  process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
);

if (!hasFirebaseCreds) {
  console.log('Kredensial Firebase tidak ditemukan -> memakai Firestore in-memory (data tidak persisten).');
  require('./mock-firebase').install({
    seedPosts: [
      {
        title: 'Selamat Datang di CMS Baru',
        content:
          'Ini adalah contoh konten yang tampil di homepage publik.\n\nKonten hanya terlihat di sini setelah admin menerbitkannya lewat dashboard.',
        author: 'Tim Editorial',
        published: true,
      },
      {
        title: 'Cara Mengelola Konten',
        content:
          'Buka /admin dan masuk dengan password admin. Dari dashboard Anda bisa menambah, mengedit, menerbitkan, dan menghapus postingan.',
        author: 'Tim Editorial',
        published: true,
      },
      {
        title: 'Draf: Konten Belum Terbit',
        content: 'Postingan ini berstatus draf sehingga TIDAK tampil di homepage publik.',
        author: 'Tim Editorial',
        published: false,
      },
    ],
  });
}

// Password default hanya untuk preview lokal (tidak dipakai di Vercel)
if (!process.env.ADMIN_PASSWORD) {
  process.env.ADMIN_PASSWORD = 'admin123';
  console.log('ADMIN_PASSWORD belum di-set -> memakai default lokal: admin123');
}

process.env.PORT = process.env.PORT || '3000';
require('../api/index');
