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

## 4. Catatan Penting untuk Fase Berikutnya

- Token access berisi `tenantId` + `role` — dipakai di modul Inventori/Penjualan/Akunting agar semua query otomatis `WHERE tenant_id = ...`. Pola untuk route baru:
  ```ts
  const user = getTenantUserFromRequest(req); // { userId, tenantId, role }
  const products = await prisma.product.findMany({ where: { tenantId: user.tenantId } });
  ```
- Untuk role-based access (misal kasir tidak boleh hapus produk), cek `user.role` di setiap route sebelum eksekusi.
- Skema Prisma (`prisma/schema.prisma`) sudah mencakup seluruh modul (inventori, penjualan, akunting) sehingga tidak perlu migrasi ulang besar-besaran di fase depan — tinggal jalankan `prisma migrate dev` lagi jika ada penyesuaian kecil.
- Ganti `SEED_SUPER_ADMIN_PASSWORD` di `.env` sebelum deploy ke production, lalu hapus/nonaktifkan skrip seed atau lindungi dengan env check.
