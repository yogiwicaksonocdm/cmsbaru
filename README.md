# Node.js CMS (Express + Firestore)

CMS sederhana dengan **homepage publik** (hanya menampilkan konten yang sudah diterbitkan) dan **dashboard admin** terproteksi password untuk mengelola konten.

## Halaman

| URL       | Akses | Keterangan                                        |
| --------- | ----- | ------------------------------------------------- |
| `/`       | Publik | Homepage: hero (background + caption), daftar postingan yang sudah diterbitkan, dan diskusi komentar per postingan |
| `/admin`  | Admin  | Dashboard dengan tiga tab: **Postingan** (tulis/edit dengan kategori & generate konten otomatis), **Komentar** (moderasi) dan **Pengaturan** (hero homepage) |

## API

| Method | Endpoint               | Akses  | Keterangan                              |
| ------ | ---------------------- | ------ | --------------------------------------- |
| GET    | `/api/posts`           | Publik | Daftar postingan terbit (beserta kategori) |
| POST   | `/api/posts/generate`  | Admin  | Auto-generate konten dari judul (AI bila `AI_API_KEY` di-set, selain itu template) |
| POST   | `/api/auth/login`      | –      | `{ password }` -> `{ token, expiresAt }` |
| GET    | `/api/auth/me`         | Admin  | Validasi sesi token                     |
| GET    | `/api/admin/posts`     | Admin  | Semua postingan (termasuk draf)         |
| POST   | `/api/posts`           | Admin  | Buat postingan (default: draf)          |
| PUT    | `/api/posts/:id`       | Admin  | Ubah judul/konten/penulis/status terbit |
| DELETE | `/api/posts/:id`       | Admin  | Hapus postingan                         |
| GET    | `/api/settings`        | Publik | Pengaturan hero homepage                |
| PUT    | `/api/settings`        | Admin  | Ubah hero: caption, teks pendukung, background |
| GET    | `/api/posts/:id/comments` | Publik | Komentar **disetujui** untuk sebuah postingan |
| POST   | `/api/posts/:id/comments` | Publik | Kirim komentar (nama ≥2 char, isi ≥3 & ≤1000 char); masuk sebagai *pending* |
| GET    | `/api/admin/comments`  | Admin  | Semua komentar (semua status) untuk moderasi |
| PATCH  | `/api/admin/comments/:id` | Admin | Moderasi komentar: `{ status: "approved|rejected|pending" }` |

Semua endpoint admin memerlukan header `Authorization: Bearer <token>` hasil login.

Setiap postingan memiliki `category` (opsional, default `Umum`) yang tampil sebagai chip di homepage lengkap dengan dropdown filter kategori. Tombol **Generate Konten** di editor memanggil `/api/posts/generate`: hasil AI bila `AI_API_KEY` di-set, dan generator template lokal bila tidak ada key atau AI sedang gagal.

Setiap postingan juga punya bagian **Komentar** dengan toggle 💬 di homepage: pengunjung bisa membaca komentar yang sudah disetujui dan mengirim komentar baru yang berstatus *pending* (pesan "menunggu moderasi admin" ditampilkan setelah terkirim). Admin memoderasinya lewat tab **Komentar** di dashboard: Setujui / Tolak / kembalikan ke *pending*.

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
| `AI_API_KEY`              | Tidak | API key AI untuk generate konten (kompatibel OpenAI)    |
| `AI_BASE_URL`             | Tidak | Endpoint API AI (default `https://api.openai.com/v1`; bisa provider/gateway apa pun yang kompatibel OpenAI) |
| `AI_MODEL`                | Tidak | Nama model AI (default `gpt-4o-mini`)                   |
| `PORT`                    | Tidak | Port server lokal (default 3000)                        |

\* Wajib agar konten tersimpan di Firestore; tanpa ini, API mengembalikan `503` dan halaman menampilkan pesan konfigurasi.

## Pengujian

```bash
npm test   # smoke test HTTP: halaman, auth, CRUD, publish/unpublish
```

## Deploy ke Vercel

`vercel.json` sudah mengarahkan `/api/*` ke fungsi serverless dan menyajikan folder `public/` sebagai file statis. Setelah impor ke Vercel, isi environment variables di atas pada project settings, lalu deploy.
