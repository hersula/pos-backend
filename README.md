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
| GET | `/api/purchase-orders/:id` | semua role | Detail PO |
| POST | `/api/purchase-orders/:id/receive` | OWNER, MANAGER, GUDANG | Terima barang → stok bertambah + `costPrice` produk ter-update |

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

# 3. Buat PO pembelian ke supplier
curl -X POST http://localhost:3000/api/purchase-orders \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "warehouseId": "<WAREHOUSE_ID>",
    "items": [ { "productId": "<PRODUCT_ID>", "qty": 100, "unitCost": 3800 } ]
  }'

# 4. Terima barang PO -> stok otomatis bertambah 100
curl -X POST http://localhost:3000/api/purchase-orders/<PO_ID>/receive \
  -H "Authorization: Bearer $TOKEN"

# 5. Cek kartu stok
curl "http://localhost:3000/api/stock-movements?productId=<PRODUCT_ID>" \
  -H "Authorization: Bearer $TOKEN"
```

### Desain penting

- **`src/lib/inventory.ts` → `adjustStock()`** adalah satu-satunya fungsi yang boleh mengubah `quantity` di tabel `stocks`. Semua fitur (adjustment manual, PO receive, dan nanti modul Penjualan saat item terjual) memanggil fungsi ini di dalam `prisma.$transaction(...)` supaya angka stok dan histori (`stock_movements`) tidak pernah tidak-sinkron.
- Produk **tidak pernah dihapus permanen** (`DELETE /api/products/:id` hanya set `isActive: false`) supaya data transaksi lama tetap valid secara referensial.
- Purchase Order berstatus `DRAFT` **tidak mengubah stok** — stok baru bertambah saat endpoint `/receive` dipanggil. Ini meniru proses nyata: PO dibuat dulu, barang fisik baru masuk gudang belakangan.
- `costPrice` produk otomatis mengikuti harga beli PO terakhir (metode "harga beli terbaru"), dipakai nanti untuk hitung HPP di modul Akunting.

---

## 5. Catatan Penting untuk Fase Berikutnya

- Token access berisi `tenantId` + `role` — dipakai di modul Inventori/Penjualan/Akunting agar semua query otomatis `WHERE tenant_id = ...`. Pola untuk route baru:
  ```ts
  const user = getTenantUserFromRequest(req); // { userId, tenantId, role }
  const products = await prisma.product.findMany({ where: { tenantId: user.tenantId } });
  ```
- Untuk role-based access (misal kasir tidak boleh hapus produk), cek `user.role` di setiap route sebelum eksekusi.
- Skema Prisma (`prisma/schema.prisma`) sudah mencakup seluruh modul (inventori, penjualan, akunting) sehingga tidak perlu migrasi ulang besar-besaran di fase depan — tinggal jalankan `prisma migrate dev` lagi jika ada penyesuaian kecil.
- Ganti `SEED_SUPER_ADMIN_PASSWORD` di `.env` sebelum deploy ke production, lalu hapus/nonaktifkan skrip seed atau lindungi dengan env check.
