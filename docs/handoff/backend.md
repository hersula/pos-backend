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
