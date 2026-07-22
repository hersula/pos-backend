# POS Backend — Fase 1 (Auth, Register Tenant, Admin Approval)

Ini adalah fondasi backend dari aplikasi POS multi-tenant. Fase ini mencakup:

- Registrasi tenant (toko/perusahaan) dengan pilihan **FREE** atau **SUBSCRIBE**
- Login user tenant (yang otomatis diblokir jika tenant belum `APPROVED`)
- Login super admin platform
- Admin approve/reject tenant
- Auto-setup data default saat tenant di-approve (warehouse "Toko Pusat" + Chart of Accounts)

Modul Inventori, Penjualan, dan Akunting akan menyusul di fase berikutnya, dibangun di atas skema Prisma yang sudah lengkap di `prisma/schema.prisma`.

---

## 1. Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env & sesuaikan
cp .env.example .env
# edit DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
# (opsional) edit WHATSAPP_* kalau mau notifikasi WA langsung aktif dari awal —
# kalau dilewati, isi manual belakangan lewat Admin Panel > Pengaturan

# 3. Buat database MySQL kosong terlebih dahulu, misal:
#    CREATE DATABASE pos_saas;

# 4. Jalankan migrasi (generate semua tabel dari schema.prisma)
npm run prisma:migrate

# 5. Buat akun super admin pertama
npm run seed

# 6. Jalankan server
npm run dev
```

Server berjalan di `http://localhost:3000`.

---

## 2. Alur Testing (curl)

### a. Registrasi tenant baru (pilih FREE)

```bash
curl -X POST http://localhost:3000/api/auth/register-tenant \
  -H "Content-Type: application/json" \
  -d '{
    "businessName": "Toko Berkah Jaya",
    "ownerName": "Budi Santoso",
    "email": "budi@tokoberkah.com",
    "phone": "08123456789",
    "address": "Jl. Merdeka No. 1",
    "password": "rahasia123",
    "planType": "FREE"
  }'
```

Response: tenant dibuat dengan `status: PENDING`. User OWNER juga dibuat tapi `isActive: false`.

### b. Coba login sebelum di-approve → akan ditolak (403)

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "budi@tokoberkah.com", "password": "rahasia123" }'
```

### c. Login sebagai super admin

```bash
curl -X POST http://localhost:3000/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "superadmin@pos.com", "password": "ChangeMe123!" }'
```

Simpan `accessToken` dari response untuk langkah berikutnya.

### d. Lihat daftar tenant yang PENDING

```bash
curl -X GET "http://localhost:3000/api/admin/tenants?status=PENDING" \
  -H "Authorization: Bearer <ACCESS_TOKEN_ADMIN>"
```

Salin `id` tenant dari response.

### e. Approve tenant

```bash
curl -X POST http://localhost:3000/api/admin/tenants/<TENANT_ID>/approve \
  -H "Authorization: Bearer <ACCESS_TOKEN_ADMIN>"
```

Ini otomatis: mengubah status tenant jadi `APPROVED`, mengaktifkan user OWNER, membuat warehouse "Toko Pusat", dan membuat Chart of Accounts default.

### f. Sekarang login sebagai owner toko akan berhasil

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "budi@tokoberkah.com", "password": "rahasia123" }'
```

Response berisi `accessToken` + `refreshToken` yang dipakai Flutter app untuk mengakses endpoint modul lain (inventori, penjualan, dll — dengan `tenantId` otomatis ter-embed di token, sehingga semua query di modul berikutnya otomatis terfilter per tenant).

### g. Reject tenant (alternatif approve)

```bash
curl -X POST http://localhost:3000/api/admin/tenants/<TENANT_ID>/reject \
  -H "Authorization: Bearer <ACCESS_TOKEN_ADMIN>" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Data usaha tidak lengkap / tidak valid" }'
```

---

## 3. Struktur Endpoint Fase 1

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| POST | `/api/auth/register-tenant` | - | Registrasi toko baru |
| POST | `/api/auth/login` | - | Login user tenant |
| POST | `/api/auth/refresh` | - | Refresh access token |
| POST | `/api/admin/auth/login` | - | Login super admin |
| GET | `/api/admin/tenants?status=PENDING&search=...` | Admin | List tenant |
| POST | `/api/admin/tenants/:id/approve` | Admin | Approve tenant |
| POST | `/api/admin/tenants/:id/reject` | Admin | Reject tenant |

Semua endpoint yang butuh auth mengharapkan header:
```
Authorization: Bearer <accessToken>
```

---

## 4. Modul Inventori (Fase 2)

Semua endpoint di bawah butuh header `Authorization: Bearer <accessToken>` milik **user tenant** (dari `/api/auth/login`), bukan token admin.

| Method | Endpoint | Role | Deskripsi |
|---|---|---|---|
| GET | `/api/categories` | semua role | List kategori |
| POST | `/api/categories` | OWNER, MANAGER, GUDANG | Tambah kategori |
| PUT/DELETE | `/api/categories/:id` | OWNER, MANAGER (delete) | Edit/hapus kategori |
| GET | `/api/warehouses` | semua role | List gudang/toko |
| POST | `/api/warehouses` | OWNER, MANAGER | Tambah gudang |
| PUT | `/api/warehouses/:id` | OWNER, MANAGER | Edit gudang |
| DELETE | `/api/warehouses/:id` | OWNER | Hapus gudang (harus stok 0) |
| GET | `/api/products?search=&categoryId=&lowStock=true&page=&pageSize=` | semua role | List produk + stok per warehouse |
| POST | `/api/products` | OWNER, MANAGER, GUDANG | Tambah produk (+ stok awal opsional) |
| GET/PUT | `/api/products/:id` | semua role / OWNER,MANAGER,GUDANG | Detail / edit produk |
| DELETE | `/api/products/:id` | OWNER, MANAGER | Soft-delete (nonaktifkan) produk |
| GET | `/api/stocks?warehouseId=&lowStock=true` | semua role | Level stok saat ini + flag stok minim |
| GET | `/api/stock-movements?productId=&warehouseId=&page=` | semua role | Kartu stok (histori mutasi) |
| POST | `/api/stock-movements` | OWNER, MANAGER, GUDANG | Koreksi stok manual (stok opname, rusak/hilang) |
| GET/POST | `/api/suppliers` | semua role / OWNER,MANAGER,GUDANG | List/tambah supplier |
| PUT/DELETE | `/api/suppliers/:id` | OWNER, MANAGER, GUDANG (edit) / OWNER, MANAGER (delete) | Edit/hapus supplier |
| GET/POST | `/api/purchase-orders` | semua role / OWNER,MANAGER,GUDANG | List/buat PO (status awal `DRAFT`, stok belum berubah) |
| GET | `/api/purchase-orders/:id` | semua role | Detail PO + riwayat cicilan pelunasan hutang |
| POST | `/api/purchase-orders/:id/receive` | OWNER, MANAGER, GUDANG | Terima barang → stok bertambah + `costPrice` produk ter-update + tentukan lunas/hutang sesuai metode bayar |
| GET/POST | `/api/purchase-orders/:id/payments` | semua role / OWNER,MANAGER,AKUNTAN | Riwayat / catat pelunasan hutang usaha (khusus PO metode `CREDIT`) |
| GET | `/api/reports/purchases-summary?dateFrom=&dateTo=` | OWNER,MANAGER,GUDANG,AKUNTAN | Ringkasan pembelian per metode bayar + daftar hutang usaha belum lunas |

### Metode Pembayaran Pengadaan Barang

Setiap PO punya `paymentMethod` yang ditentukan saat dibuat (`POST /api/purchase-orders`), berpengaruh ke jurnal akunting saat barang diterima:

| `paymentMethod` | Label | Perilaku saat `/receive` |
|---|---|---|
| `CASH` | Tunai | Langsung lunas — jurnal Debit Persediaan / Kredit **Kas** |
| `TRANSFER` | Transfer Bank | Langsung lunas — jurnal Debit Persediaan / Kredit **Bank** |
| `CREDIT` | Tempo | Jadi hutang (`paymentStatus: UNPAID`) — jurnal Debit Persediaan / Kredit **Hutang Usaha**, dilunasi belakangan lewat `/payments` |

`paymentStatus` (`UNPAID`/`PARTIAL`/`PAID`) dan `paidAmount` otomatis ter-update setiap kali endpoint `/payments` dipanggil, sampai lunas penuh.

### Contoh alur testing

```bash
TOKEN="<accessToken hasil login user tenant>"

# 1. Buat kategori
curl -X POST http://localhost:3000/api/categories \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Minuman" }'

# 2. Buat produk + stok awal (warehouseId ambil dari GET /api/warehouses, otomatis ada "Toko Pusat" setelah tenant di-approve)
curl -X POST http://localhost:3000/api/products \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "Teh Botol 450ml",
    "categoryId": "<CATEGORY_ID>",
    "sellPrice": 6000,
    "costPrice": 4000,
    "minStock": 10,
    "initialStock": { "warehouseId": "<WAREHOUSE_ID>", "quantity": 50 }
  }'

# 3. Buat PO pembelian ke supplier secara TEMPO (hutang)
curl -X POST http://localhost:3000/api/purchase-orders \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "warehouseId": "<WAREHOUSE_ID>",
    "paymentMethod": "CREDIT",
    "items": [ { "productId": "<PRODUCT_ID>", "qty": 100, "unitCost": 3800 } ]
  }'

# 4. Terima barang PO -> stok otomatis bertambah 100, status hutang UNPAID
curl -X POST http://localhost:3000/api/purchase-orders/<PO_ID>/receive \
  -H "Authorization: Bearer $TOKEN"

# 5. Cicil pelunasan hutang
curl -X POST http://localhost:3000/api/purchase-orders/<PO_ID>/payments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "method": "TRANSFER", "amount": 200000, "referenceNo": "TRF001" }'

# 6. Cek kartu stok
curl "http://localhost:3000/api/stock-movements?productId=<PRODUCT_ID>" \
  -H "Authorization: Bearer $TOKEN"

# 7. Ringkasan pembelian & hutang usaha bulan ini
curl "http://localhost:3000/api/reports/purchases-summary" -H "Authorization: Bearer $TOKEN"
```

### Desain penting

- **`src/lib/inventory.ts` → `adjustStock()`** adalah satu-satunya fungsi yang boleh mengubah `quantity` di tabel `stocks`. Semua fitur (adjustment manual, PO receive, dan nanti modul Penjualan saat item terjual) memanggil fungsi ini di dalam `prisma.$transaction(...)` supaya angka stok dan histori (`stock_movements`) tidak pernah tidak-sinkron.
- Produk **tidak pernah dihapus permanen** (`DELETE /api/products/:id` hanya set `isActive: false`) supaya data transaksi lama tetap valid secara referensial.
- Purchase Order berstatus `DRAFT` **tidak mengubah stok** — stok baru bertambah saat endpoint `/receive` dipanggil. Ini meniru proses nyata: PO dibuat dulu, barang fisik baru masuk gudang belakangan.
- `costPrice` produk otomatis mengikuti harga beli PO terakhir (metode "harga beli terbaru"), dipakai nanti untuk hitung HPP di modul Akunting.
- Pelunasan hutang (`/payments`) memvalidasi jumlah bayar tidak boleh melebihi sisa hutang, dan menolak kalau PO bukan `CREDIT` atau sudah `PAID` — konsisten dengan pola validasi pelunasan piutang di modul Penjualan.

---

## 5. Modul Penjualan / POS (Fase 3)

| Method | Endpoint | Role | Deskripsi |
|---|---|---|---|
| GET | `/api/sales?status=&warehouseId=&cashierId=&dateFrom=&dateTo=&page=` | semua role | Riwayat transaksi |
| POST | `/api/sales` | OWNER, MANAGER, KASIR | Buat transaksi baru (diskon, PPN, split payment) |
| GET | `/api/sales/:id` | semua role | Detail transaksi (dipakai buat render struk) |
| POST | `/api/sales/:id/cancel` | OWNER, MANAGER | Batalkan transaksi → stok otomatis dikembalikan |
| POST | `/api/sales/:id/payments` | OWNER, MANAGER, KASIR | Tambah pembayaran susulan (pelunasan status `PARTIAL`) |
| GET/POST | `/api/customers` | semua role | List/tambah pelanggan |
| PUT/DELETE | `/api/customers/:id` | semua role | Edit/hapus pelanggan |
| GET | `/api/reports/sales-summary?dateFrom=&dateTo=&warehouseId=&cashierId=` | semua role | Ringkasan tutup kasir: omzet, diskon, PPN, jumlah item terjual, produk terlaris, rekap per metode bayar |

### Body `POST /api/sales`

```json
{
  "warehouseId": "<WAREHOUSE_ID>",
  "customerId": null,
  "items": [
    { "productId": "<PRODUCT_ID_1>", "qty": 2, "unitPrice": 6000 },
    { "productId": "<PRODUCT_ID_2>", "qty": 1, "unitPrice": 15000, "discountAmount": 1000 }
  ],
  "discountType": "PERCENT",
  "discountValue": 5,
  "taxPercent": 11,
  "payments": [
    { "method": "CASH", "amount": 20000 },
    { "method": "QRIS", "amount": 10000, "referenceNo": "TRX123456" }
  ],
  "note": "Bungkus terpisah"
}
```

- `unitPrice` boleh dikosongkan → otomatis ambil `sellPrice` produk saat ini.
- `discountType`/`discountValue` berlaku di level struk (subtotal). Diskon per item pakai `discountAmount` di masing-masing item.
- `payments` bisa lebih dari satu baris (split payment) — total dari semua metode dibandingkan ke `grandTotal`:
  - totalPembayaran ≥ grandTotal → status `PAID`, sisa lebih jadi `changeAmount` (kembalian)
  - totalPembayaran < grandTotal → status `PARTIAL` (tercatat sebagai piutang, bisa dilunasi lewat `POST /api/sales/:id/payments`)
- Stok dikurangi otomatis per item saat transaksi dibuat, dan gagal total (rollback) kalau ada 1 saja produk yang stoknya tidak cukup — respons `400` dengan pesan stok yang kurang.

### Contoh testing

```bash
TOKEN="<accessToken kasir/owner>"

curl -X POST http://localhost:3000/api/sales \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "warehouseId": "<WAREHOUSE_ID>",
    "items": [ { "productId": "<PRODUCT_ID>", "qty": 3 } ],
    "discountType": "NOMINAL",
    "discountValue": 2000,
    "taxPercent": 11,
    "payments": [ { "method": "CASH", "amount": 30000 } ]
  }'

# Cek detail utk cetak struk
curl "http://localhost:3000/api/sales/<SALE_ID>" -H "Authorization: Bearer $TOKEN"

# Ringkasan tutup kasir hari ini
curl "http://localhost:3000/api/reports/sales-summary" -H "Authorization: Bearer $TOKEN"
```

### Desain penting

- **`src/lib/sales.ts`** — `calculateSaleTotals()` (rumus subtotal → diskon → PPN → grand total, dipakai backend agar frontend tidak perlu dipercaya untuk hitung total) dan `generateInvoiceNumber()` (format `INV-YYYYMMDD-0001`, sequence per tenant per hari).
- Pengurangan stok memakai `adjustStock()` yang sama dari modul Inventori (`referenceType: 'SALE'`), sehingga kartu stok (`/api/stock-movements`) otomatis mencatat histori penjualan juga.
- Pembatalan transaksi mengembalikan stok dengan `allowNegative: true` supaya tetap bisa dibatalkan meski produk sudah diubah/dinonaktifkan setelahnya.
- Endpoint `sales-summary` dirancang untuk fitur "Tutup Kasir" di Flutter — kasir bisa mencocokkan uang cash fisik & mutasi QRIS/EDC terhadap rekap `byPaymentMethod`, plus `totalItemsSold` (total qty semua item terjual) dan `topProducts` (5 produk terlaris berdasarkan qty, dihitung dari data `items` yang sudah di-`include` sekalian — tidak nambah query terpisah).

---

## 6. Modul Akunting (Fase 4)

Prinsip: **tidak ada input jurnal manual untuk transaksi operasional** — jurnal dibuat otomatis dan konsisten setiap kali ada Penjualan, Penerimaan PO, atau Beban dicatat. User tinggal melihat laporannya.

| Method | Endpoint | Role | Deskripsi |
|---|---|---|---|
| GET/POST | `/api/accounting/chart-of-accounts` | semua role / OWNER,AKUNTAN | Lihat/tambah akun kustom (10 akun default sudah otomatis ada) |
| PUT/DELETE | `/api/accounting/chart-of-accounts/:id` | OWNER, AKUNTAN | Rename akun / hapus akun kustom (akun default tidak bisa dihapus) |
| GET | `/api/accounting/journal?dateFrom=&dateTo=&referenceType=&page=` | OWNER, MANAGER, AKUNTAN | Jurnal umum — semua entry + baris debit/kredit |
| GET | `/api/accounting/ledger?accountId=&dateFrom=&dateTo=` | OWNER, MANAGER, AKUNTAN | Buku besar per akun, lengkap saldo berjalan |
| GET/POST | `/api/expenses` | semua role / OWNER,MANAGER,AKUNTAN | List/catat beban operasional (auto-jurnal) |
| DELETE | `/api/expenses/:id` | OWNER, MANAGER, AKUNTAN | Hapus beban → otomatis buat jurnal balik |
| GET | `/api/reports/profit-loss?dateFrom=&dateTo=` | OWNER, MANAGER, AKUNTAN | Laporan Laba Rugi: Pendapatan − HPP = Laba Kotor − Beban Operasional = Laba Bersih, plus `additionalInfo` (total pembelian periode & saldo hutang usaha berjalan — informasi konteks, bukan pengurang laba) |
| GET | `/api/reports/purchases-summary?dateFrom=&dateTo=` | OWNER,MANAGER,GUDANG,AKUNTAN | Ringkasan pembelian per metode bayar + daftar hutang usaha belum lunas |

### Kapan jurnal otomatis dibuat

| Kejadian | Jurnal |
|---|---|
| `POST /api/sales` (transaksi baru) | Debit Kas/Bank (+Piutang jika `PARTIAL`) — Kredit Pendapatan & PPN Keluaran, plus Debit HPP — Kredit Persediaan sebesar harga modal barang terjual |
| `POST /api/sales/:id/cancel` | Jurnal balik (reversing entry) otomatis dari jurnal penjualan asal |
| `POST /api/purchase-orders/:id/receive` | Debit Persediaan Barang — Kredit **Kas** (metode `CASH`) / **Bank** (`TRANSFER`) / **Hutang Usaha** (`CREDIT`), sebesar total PO |
| `POST /api/purchase-orders/:id/payments` | Debit Hutang Usaha — Kredit Kas/Bank, sebesar cicilan yang dibayar (khusus PO metode `CREDIT`) |
| `POST /api/expenses` | Debit Beban Operasional — Kredit Kas |
| `DELETE /api/expenses/:id` | Jurnal balik otomatis dari jurnal beban asal |

> **Kenapa pembelian tidak muncul sebagai beban di Laba Rugi?** Karena secara akuntansi, barang yang dibeli awalnya menambah **aset** (Persediaan), bukan langsung jadi beban — baru berubah jadi HPP (beban) saat barang itu **terjual**. Ini prinsip standar (matching principle). Karena itu modul Pengadaan Barang "masuk" ke laporan akunting lewat: (1) jurnal otomatis yang tercatat di Jurnal Umum & Buku Besar seperti transaksi lain, dan (2) field `additionalInfo` di laporan Laba Rugi serta endpoint `purchases-summary` khusus — sebagai informasi pelengkap, tanpa mendistorsi angka laba yang sebenarnya.

Semua ini terjadi **di dalam `prisma.$transaction` yang sama** dengan aksi utamanya (lihat `src/lib/accounting.ts`), jadi tidak mungkin ada transaksi penjualan yang tersimpan tanpa jurnalnya, atau sebaliknya.

### Contoh testing

```bash
TOKEN="<accessToken owner/akuntan>"

# Catat beban listrik
curl -X POST http://localhost:3000/api/expenses \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "category": "Listrik", "amount": 350000, "expenseDate": "2026-07-01", "description": "Tagihan Juli" }'

# Lihat jurnal umum bulan ini
curl "http://localhost:3000/api/accounting/journal?dateFrom=2026-07-01&dateTo=2026-07-31" \
  -H "Authorization: Bearer $TOKEN"

# Buku besar akun Kas (code 1000) - ambil accountId dari GET /api/accounting/chart-of-accounts
curl "http://localhost:3000/api/accounting/ledger?accountId=<ACCOUNT_ID_KAS>" \
  -H "Authorization: Bearer $TOKEN"

# Laporan laba rugi bulan berjalan (sudah termasuk additionalInfo pembelian & hutang usaha)
curl "http://localhost:3000/api/reports/profit-loss" -H "Authorization: Bearer $TOKEN"

# Ringkasan pembelian & hutang usaha
curl "http://localhost:3000/api/reports/purchases-summary" -H "Authorization: Bearer $TOKEN"
```

### Desain penting

- **`src/lib/accounting.ts`** — `createJournalEntry()` memvalidasi total debit harus sama dengan total kredit (toleransi 1 sen) sebelum simpan, jadi tidak mungkin ada jurnal yang tidak balance masuk ke database.
- `postSaleJournal()` menggabungkan semua metode pembayaran non-tunai (DEBIT/CREDIT/QRIS/TRANSFER/EWALLET) ke akun **1100 Bank** demi kesederhanaan. Kalau butuh akun terpisah per metode (mis. akun khusus "Piutang EDC"), tinggal tambah `ACCOUNT_CODES` baru dan sesuaikan mapping di fungsi ini.
- `reverseJournalForReference()` dipakai baik untuk pembatalan penjualan maupun penghapusan beban — mencari semua jurnal yang terhubung ke sebuah referensi lalu membuat entry baru dengan debit/kredit tertukar, bukan menghapus histori asli (prinsip *audit trail* akunting: data lama tidak boleh hilang).
- HPP (harga pokok penjualan) dihitung dari `product.costPrice` **pada saat produk terjual** (bukan harga beli rata-rata/FIFO) — cukup akurat untuk UMKM, dan `costPrice` sendiri otomatis ter-update tiap kali PO di-receive (lihat modul Inventori).
- Laporan Laba Rugi murni dihitung dari `journal_lines`, bukan query langsung ke tabel `sales`/`expenses` — supaya kalau suatu saat ada jurnal manual tambahan, laporan tetap akurat.

---

## 8. Admin Panel Web (Fase 5)

Halaman web untuk tim platform meninjau & menyetujui/menolak pendaftaran tenant — bagian dari project Next.js yang sama (bukan project terpisah), jalan otomatis begitu `npm run dev` dijalankan.

| Halaman | URL | Deskripsi |
|---|---|---|
| Login | `/admin/login` | Login super admin (pakai akun dari `npm run seed`) |
| Dashboard | `/admin/dashboard` | Tabel tenant dengan filter status, pencarian, tombol Setujui/Tolak, dan ringkasan jumlah per status |
| Pengaturan | `/admin/settings` | Atur Device ID gateway WhatsApp + tombol kirim pesan test (khusus Super Admin untuk simpan) |

Cara pakai:
```bash
npm run dev
# buka http://localhost:3000/admin
```

- Token admin disimpan di `localStorage` browser (`src/lib/admin-client.ts`), otomatis redirect ke `/admin/login` kalau belum login atau token kedaluwarsa (401).
- Approve/Reject di dashboard langsung memanggil endpoint `/api/admin/tenants/:id/approve` & `/api/admin/tenants/:id/reject` yang sudah dibangun di Fase 1 — tidak ada logic baru di backend, halaman ini murni UI di atas API yang sudah ada.
- Tombol **Setujui** minta konfirmasi browser dulu (aksinya langsung mengaktifkan akun toko). Tombol **Tolak** membuka dialog untuk mengisi alasan (wajib diisi, ditampilkan ke pemilik toko saat mereka coba login).
- Styling murni CSS custom di `src/app/admin/admin.css` (tanpa library UI eksternal) — badge status dibuat bergaya "cap stempel" (PENDING/DISETUJUI/DITOLAK) supaya jelas ini adalah halaman persetujuan dokumen/administrasi.
- Modul **Langganan** (kelola paket & pembayaran subscription) sengaja belum dibuatkan halamannya — data `subscriptions` sudah ada di database sejak registrasi, tapi UI-nya menyusul setelah integrasi payment gateway.

### Notifikasi WhatsApp (approve/tolak tenant)

Setiap kali tenant di-approve atau ditolak, backend otomatis mengirim pesan WhatsApp ke `tenant.phone` lewat gateway eksternal (`src/lib/whatsapp.ts`).

| Endpoint | Role | Deskripsi |
|---|---|---|
| `GET /api/admin/settings/whatsapp` | Admin (semua role) | Lihat pengaturan saat ini (`deviceId`, `enabled`, sumber `deviceId` dari database/env) |
| `PUT /api/admin/settings/whatsapp` | Super Admin only | Ubah Device ID / aktif-nonaktifkan, opsional sekalian kirim pesan test (`testPhone`) |

**Kenapa Device ID bisa diganti tanpa redeploy:** `WHATSAPP_DEVICE_ID` di `.env` cuma jadi *default awal*. Begitu Super Admin menyimpan Device ID baru lewat halaman `/admin/settings`, nilainya disimpan di tabel `platform_settings` (key-value generik, `prisma/schema.prisma` model `PlatformSetting`) dan **selalu diprioritaskan** di atas nilai `.env`. Ini dipakai supaya kalau device WhatsApp gateway-nya diganti (device baru, session logout, dsb), admin platform bisa update sendiri tanpa perlu minta developer redeploy.

Variabel lain (`WHATSAPP_API_URL`, `WHATSAPP_AUTH_USERNAME`, `WHATSAPP_AUTH_PASSWORD`) sengaja **tetap** hanya lewat `.env` (bukan diedit lewat UI) karena ini kredensial sensitif — beda dari Device ID yang lebih sering berubah dan tidak serahasia itu.

Pengiriman WhatsApp bersifat **non-blocking**: dipanggil tanpa `await` penuh (`.catch(...)` saja) supaya kegagalan gateway (mati, salah device ID, dll) tidak menggagalkan proses approve/reject itu sendiri — cukup di-log ke console server.

```bash
# Contoh: ubah Device ID & langsung test kirim
curl -X PUT http://localhost:3000/api/admin/settings/whatsapp \
  -H "Authorization: Bearer <ACCESS_TOKEN_SUPER_ADMIN>" -H "Content-Type: application/json" \
  -d '{ "deviceId": "device-baru-xxxx", "enabled": true, "testPhone": "08123456789" }'
```

---

## 9. Catatan Teknis Umum

- Token access berisi `tenantId` + `role` — dipakai di modul Inventori/Penjualan/Akunting agar semua query otomatis `WHERE tenant_id = ...`. Pola untuk route baru:
  ```ts
  const user = getTenantUserFromRequest(req); // { userId, tenantId, role }
  const products = await prisma.product.findMany({ where: { tenantId: user.tenantId } });
  ```
- Untuk role-based access (misal kasir tidak boleh hapus produk), cek `user.role` di setiap route sebelum eksekusi.
- Skema Prisma (`prisma/schema.prisma`) sudah mencakup seluruh modul (inventori, penjualan, akunting) sehingga tidak perlu migrasi ulang besar-besaran di fase depan — tinggal jalankan `prisma migrate dev` lagi jika ada penyesuaian kecil.
- Ganti `SEED_SUPER_ADMIN_PASSWORD` di `.env` sebelum deploy ke production, lalu hapus/nonaktifkan skrip seed atau lindungi dengan env check.
- Sebelum `npm run build` / `npm run dev`, pastikan `npx prisma generate` sukses dulu (otomatis jalan lewat `npm install`, tapi jalankan manual kalau ada perubahan di `schema.prisma`). Tanpa ini, TypeScript akan error karena tipe seperti `Prisma.SaleWhereInput` belum ter-generate.

## 10. Sisa Roadmap

Backend API (Fase 1–4) dan Admin Panel web (Fase 5) sudah lengkap. Yang belum dibangun:

- **Fase 6** — Aplikasi mobile Flutter yang mengonsumsi seluruh API di atas + cetak struk Bluetooth
- Integrasi payment gateway (Midtrans/Xendit) untuk tenant `SUBSCRIBE` + halaman kelola langganan di admin panel
- ~~Notifikasi email~~ — sudah diganti notifikasi **WhatsApp** (lihat bagian Admin Panel di atas), lebih relevan untuk target pengguna UMKM
