# Handoff: Backend — App Version / Auto Update

**Status:** SELESAI — Fitur auto-update aplikasi mobile siap untuk integrasi frontend.

## File berubah
- `prisma/schema.prisma`: +enum `AppPlatform`, +model `AppVersion`
- `prisma/migrations/20261115071900_add_app_version/migration.sql`: tabel `app_versions` + enum
- `src/app/api/app/version/route.ts`: endpoint publik GET (response sesuai kontrak)
- `src/app/api/app/versions/route.ts`: endpoint admin GET list + POST create
- `src/app/api/app/versions/[id]/route.ts`: endpoint admin PATCH + DELETE (soft)
- `docs/api-contract.md`: +bagian "App Version / Auto Update" (full spec)

## Cara menjalankan
1. **Jalankan migrasi** (Linux/PowerShell): `npx prisma migrate deploy` atau `npx prisma db push`
2. **Build & type check**: `npm run build`
3. **Test publik GET**: `curl 'http://localhost:3000/api/app/version?platform=android'`
4. **Test admin CRUD**: `curl -H 'Authorization: Bearer {token}' http://localhost:3000/api/app/versions`

## Asumsi
- Auth helper `getTenantUserFromRequest()` + `requireRole()` sudah bekerja
- Prisma client dan DB tersedia

## Catatan
- Endpoint publik tidak memerlukan JWT (aman untuk mobile)
- Soft delete mengikuti pola existing
- Response format sesuai kontrak standar + error 422 untuk validasi

## [15/11] Kategori nonaktif (T8)
Status: SELESAI (kode + schema). Migrasi BELUM dijalankan ke DB (sesuai batasan tugas).

File diubah:
- `prisma/schema.prisma` (Category.isActive, index tenantId+isActive)
- `prisma/migrations/20261115080000_add_category_is_active/migration.sql` (migrasi baru, MySQL/MariaDB murni)
- `src/app/api/categories/route.ts` (GET default aktif saja, `?includeInactive=true`, POST set isActive=true)
- `src/app/api/categories/[id]/route.ts` (PATCH baru: OWNER/MANAGER, body `{name?, isActive?}`)
- `docs/api-contract.md` (bagian baru "Kategori Produk")

Cara jalankan migrasi (saat siap): `npx prisma migrate deploy` (prod) atau `npx prisma migrate dev` (dev).

Verifikasi: `npx prisma validate` OK, `npx prisma generate` OK. `npx tsc --noEmit` tidak menambah error baru pada file kategori (ada error pre-existing tidak terkait di `products/[id]/prices` dan `units`, tidak disentuh tugas ini).

Masalah terbuka: belum ada endpoint khusus "daftar kategori untuk pemilihan produk" selain `GET /api/categories`; filter aktif sudah jadi default endpoint tersebut.
