# Node.js CMS (Express + Firestore)

CMS sederhana dengan **homepage publik** (hanya menampilkan konten yang sudah diterbitkan) dan **dashboard admin** terproteksi password untuk mengelola konten.

## Halaman

| URL       | Akses | Keterangan                                        |
| --------- | ----- | ------------------------------------------------- |
| `/`       | Publik | Homepage: hero (background + caption) dan daftar postingan yang sudah diterbitkan |
| `/admin`  | Admin  | Dashboard: tambah, edit, terbitkan, hapus konten, dan atur hero homepage |

## API

| Method | Endpoint               | Akses  | Keterangan                              |
| ------ | ---------------------- | ------ | --------------------------------------- |
| GET    | `/api/posts`           | Publik | Daftar postingan terbit                 |
| POST   | `/api/auth/login`      | –      | `{ password }` -> `{ token, expiresAt }` |
| GET    | `/api/auth/me`         | Admin  | Validasi sesi token                     |
| GET    | `/api/admin/posts`     | Admin  | Semua postingan (termasuk draf)         |
| POST   | `/api/posts`           | Admin  | Buat postingan (default: draf)          |
| PUT    | `/api/posts/:id`       | Admin  | Ubah judul/konten/penulis/status terbit |
| DELETE | `/api/posts/:id`       | Admin  | Hapus postingan                         |
| GET    | `/api/settings`        | Publik | Pengaturan hero homepage                |
| PUT    | `/api/settings`        | Admin  | Ubah hero: caption, teks pendukung, background |

Semua endpoint admin memerlukan header `Authorization: Bearer <token>` hasil login.

## Setup lokal

```bash
npm install
cp .env.example .env   # lalu isi nilai-nilainya
npm run dev            # atau: npm start
```

Buka `http://localhost:3000` (homepage) dan `http://localhost:3000/admin` (dashboard).

Tanpa kredensial Firebase, jalankan `npm run preview` untuk mencoba CMS dengan Firestore in-memory (data tidak persisten, hanya untuk uji coba).

### Environment Variables

| Variabel                  | Wajib | Keterangan                                              |
| ------------------------- | ----- | ------------------------------------------------------- |
| `ADMIN_PASSWORD`          | Ya    | Password login dashboard admin                          |
| `ADMIN_AUTH_SECRET`       | Tidak | Secret HMAC untuk token admin (default: `ADMIN_PASSWORD`) |
| `FIREBASE_PROJECT_ID`     | Ya*   | ID project Firebase                                     |
| `FIREBASE_CLIENT_EMAIL`   | Ya*   | Email service account Firestore                         |
| `FIREBASE_PRIVATE_KEY`    | Ya*   | Private key service account (pakai `\n` untuk newline)  |
| `PORT`                    | Tidak | Port server lokal (default 3000)                        |

\* Wajib agar konten tersimpan di Firestore; tanpa ini, API mengembalikan `503` dan halaman menampilkan pesan konfigurasi.

## Pengujian

```bash
npm test   # smoke test HTTP: halaman, auth, CRUD, publish/unpublish
```

## Deploy ke Vercel

`vercel.json` sudah mengarahkan `/api/*` ke fungsi serverless dan menyajikan folder `public/` sebagai file statis. Setelah impor ke Vercel, isi environment variables di atas pada project settings, lalu deploy.
