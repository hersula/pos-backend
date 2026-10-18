# Serah terima: backend (modul Stock Opname)

- Status: SELESAI (kontrak + skema + endpoint). Belum diuji terhadap DB nyata; migrasi TIDAK dijalankan.
- Verifikasi: `npx prisma validate` + `prisma generate` OK; `npx tsc --noEmit`: 0 error di file opname. Ada 9 error TS yang SUDAH ADA di file belum-ter-commit milik pekerjaan lain (`src/app/api/products/[id]/prices|units`, `src/lib/units.ts`: skema ProductPrice/ProductUnit/PriceLevel tidak cocok), sehingga `npm run build` tidak dijalankan/akan gagal sampai itu beres. Bukan bagian tugas ini.

## File
- Kontrak: `docs/api-contract.md` (bagian Stock Opname di akhir), salinan `/home/sule/Projects/pos-mobile/docs/api-contract-stock-opname.md`
- Skema: `prisma/schema.prisma` (enum StockOpnameStatus, StockOpname, StockOpnameItem; relasi balik di Tenant/Warehouse/Product), migrasi `prisma/migrations/20261018000000_add_stock_opname/migration.sql` (hanya CREATE TABLE/FK, dibuat via `prisma migrate diff`)
- Kode: `src/lib/stock-opname.ts`, `src/app/api/stock-opnames/{route.ts,[id]/route.ts,[id]/items/route.ts,[id]/finalize/route.ts,[id]/cancel/route.ts}`

## Menjalankan
`npx prisma generate && npx tsc --noEmit`; terapkan migrasi di lingkungan yang disetujui: `npx prisma migrate deploy`.

## Keputusan penting
- Finalisasi menerapkan selisih RELATIF (`diff = counted - systemQty`) ke stok saat ini, bukan menimpa stok; transaksi setelah snapshot tidak hilang. `stockBeforeFinalize` dan `appliedDiff` disimpan per item; detail DRAFT menampilkan `currentQty` + `stockChanged`.
- Hasil negatif => 409 `STOCK_CONFLICT` (tanpa perubahan); opsi `clampToZero` menahan stok di 0.
- Item belum dihitung dilewati; minimal 1 item terhitung (`NO_COUNTED_ITEMS`).
- Snapshot = semua produk aktif tenant (stok 0 bila tak ada baris stok), filter kategori opsional. Gudang CONSIGNMENT ditolak.
- Role: create/finalize/cancel OWNER+MANAGER; hitung OWNER/MANAGER/GUDANG/KASIR; baca semua role. Isolasi tenant: semua query memakai `tenantId` JWT, ID asing => 404. Row lock `FOR UPDATE` pada sesi mencegah finalisasi ganda/paralel.
- `unitCost` snapshot dari `Product.costPrice` (nilai selisih). Tanpa jurnal akuntansi (MVP). Memakai ulang `ConsignError/parseBody/handleConsignError` dari `lib/consignment.ts` (alias OpnameError).
- Peringatan: GUDANG tidak disebut di brief tetapi diizinkan menghitung (pola adjustment manual).

## Belum selesai
- Tidak ada uji otomatis/uji DB (proyek tanpa framework test; hanya skrip `tests/*.mjs` e2e). 

## Permintaan ke agent lain
- qc: uji skenario selisih +/-, stok berubah setelah snapshot, STOCK_CONFLICT, finalisasi ganda, isolasi tenant, role KASIR; tambahkan `tests/stock-opname-e2e.mjs`.
- devops/pengguna: jalankan migrasi di DB setelah review; perbaiki error TS di produk (units/prices) agar build lulus.

---
(Serah terima sebelumnya, Konsinyasi:)


- Status: SELESAI (kode + kontrak). Belum diuji terhadap database nyata (tidak ada DB; migrasi tidak dijalankan).
- Verifikasi yang dijalankan: `npx prisma validate`, `npx prisma generate`, `npx tsc --noEmit` (bersih), `npm run build` (sukses). Dijalankan dengan `DATABASE_URL` dummy; `.env` asli tidak dibaca. Proyek tidak punya framework test, jadi tidak ada test otomatis baru (lihat permintaan ke qc).
- Catatan: `npm ci` dijalankan (node_modules sebelumnya kosong) dan `npm run build` mengubah `tsconfig.tsbuildinfo` (file ter-track); pengguna dapat `git checkout tsconfig.tsbuildinfo`. Percobaan saya mengembalikannya ditolak/timeout oleh hook persetujuan.

## Hasil verifikasi [VERIFIKASI-BE] dan deviasi dari rancangan
| Klaim | Kenyataan | Dampak |
|---|---|---|
| Model stok | `Stock(productId, warehouseId, quantity)` unik per produk+gudang; `StockMovement` | sesuai |
| Tipe movement | Enum Prisma `StockMovementType {IN, OUT, ADJUSTMENT, TRANSFER}`; `referenceType` string bebas | DEVIASI: tidak perlu enum baru `CONSIGN_*`. Dipakai `TRANSFER` + referenceType `CONSIGNMENT_SEND/RETURN/CANCEL`. Enum tidak berubah |
| Logika Sale | Ada langsung di `sales/route.ts` | DIREFACTOR ke `src/lib/sale-service.ts` (`createSaleInTx`, `freeLimitBlock`), dipakai `POST /sales` dan settle-sale |
| Tenant validation | Warehouse, produk, satuan divalidasi; **`customerId` di `POST /sales` TIDAK divalidasi** (celah lintas-tenant) | Ditambah validasi (404) |
| Role helper | `requireRole(user, [...])`, `getTenantUserFromRequest` di `lib/auth.ts` | dipakai apa adanya |
| Konvensi ID/kolom | uuid + kolom snake_case via `@map` (rancangan memakai cuid/camelCase) | skema mengikuti konvensi proyek |

## Bug prasyarat (keduanya TERBUKTI ADA, sudah diperbaiki)
- (a) `sales/[id]/cancel`: stok dikembalikan `item.qty`, bukan `qty x conversionQty`. Jual 2 Dus (24) mengurangi 48 tapi cancel hanya menambah 2. Perbaikan: `item.qty * item.conversionQty` (snapshot di SaleItem). Tambahan: cancel mengklaim status lewat `updateMany` bersyarat (cegah cancel ganda paralel).
- (b) `sales/[id]/payments`: hanya membuat `SalePayment` dan mengubah `paidTotal`; tidak ada jurnal, jadi kas/bank dan piutang buku besar tidak berubah saat pelunasan. Perbaikan: `postSalePaymentJournal` (`SALE_PAYMENT`: Dr Kas/Bank, Cr Piutang Usaha) sebesar `min(amount, sisa piutang)` agar tetap balance saat ada kembalian. Cancel Sale kini juga membalik jurnal `SALE_PAYMENT`. Status dibaca ulang di dalam transaksi.
- Hardening `adjustStock`: pengurangan stok memakai update kondisional (`quantity >= qty`) agar transaksi paralel tidak membuat stok negatif.

## File utama
- Skema: `prisma/schema.prisma`; migrasi `prisma/migrations/20261017000000_add_consignment/migration.sql` (dibuat lewat `prisma migrate diff` tanpa DB; murni additive).
- Kontrak: `docs/api-contract.md`.
- Kode baru: `src/lib/consignment.ts`, `src/lib/sale-service.ts`, `src/app/api/consignments/**` (route, `[id]`, send, settle-sale, return, cancel, outlet-stock). Diubah: `sales/route.ts`, `sales/[id]/cancel`, `sales/[id]/payments`, `warehouses`, `warehouses/[id]`, `lib/accounting.ts`, `lib/inventory.ts`.
- Catatan: file lama berakhiran baris CRLF dipertahankan; `schema.prisma` sempat dirapikan `prisma format` (diff perataan kolom).

## Endpoint (detail di kontrak)
GET/POST `/api/consignments`, GET/PUT `/api/consignments/{id}`, POST `/{id}/send`, `/{id}/settle-sale`, `/{id}/return`, `/{id}/cancel`, GET `/api/consignments/outlet-stock`. `GET /api/warehouses?type=STORE(default)|CONSIGNMENT|ALL`. Baca: semua role; tulis: OWNER, MANAGER (GUDANG tidak boleh menulis, sesuai instruksi; berbeda dari draf analisis). `GET /reports/consignment` tidak dibuat (Should/Could); posisi titipan tersedia via outlet-stock.

## Keputusan
- Mutasi per dokumen diserialkan dengan `SELECT ... FOR UPDATE` pada baris `consignment_orders`; semua dalam `prisma.$transaction`.
- Tambahan kontrak vs rancangan: `useBaseUnit` pada baris settle/retur (agar bisa lapor 30 Botol dari 2 Dus), `agreedUnitPrice` opsional, `summary` nilai di list.
- `taxPercent` settle default 11 (sama dengan POST /sales).

## Cara menjalankan
```
cd C:\laragon\www\pos-backend
npm ci
npx prisma generate
npx tsc --noEmit
npm run build
# migrasi (oleh pengguna, setelah backup DB): npx prisma migrate deploy
```

## Belum selesai / risiko
- Migrasi belum diterapkan ke DB mana pun; skenario stok/jurnal belum diuji end-to-end.
- Data lama: pelunasan piutang sebelum perbaikan tidak punya jurnal. Perlu keputusan backfill. Membatalkan Sale lama yang sudah dicicil membalik jurnal penjualan penuh tanpa jurnal cicilannya.
- (Terselesaikan, putaran QC) guard CONSIGNMENT sudah ada di `stock-movements` POST dan `purchase-orders` POST.
- Metode `CREDIT` pada pelunasan tetap diterima (dijurnal ke Bank), perilaku lama dipertahankan.
- `GET /warehouses` default STORE: klien yang butuh semua gudang harus pakai `?type=ALL` (belum dicek apakah halaman admin memakainya).

## Permintaan ke agent lain
- frontend: ikuti `docs/api-contract.md` bagian 2-4; checkout otomatis hanya menerima gudang STORE.
- qc: skenario kirim 2 Dus (48) -> terjual 30 Botol (`useBaseUnit`) -> retur 18 -> SETTLED; cancel Sale konsinyasi -> stok kembali ke gudang konsinyasi & `baseQtySold` turun; cancel Sale 2 Dus -> stok +48; pelunasan piutang terjurnal & balance; lintas tenant -> 404; KASIR 403 pada tulis. Perlu DB uji dan test runner.
- devops/pengguna: backup DB lalu `prisma migrate deploy`.

## Perbaikan temuan QC (putaran 1)
- BUG-001: `POST /stock-movements` dan `POST /purchase-orders` menolak gudang CONSIGNMENT dengan 400, code `CONSIGNMENT_WAREHOUSE`.
- BUG-003: transaksi send/settle-sale/return/cancel konsinyasi memakai `{ timeout: 20000, maxWait: 20000 }`.
- BUG-002: P2034 pada pembayaran paralel (sales dan purchase-orders payments) kini 409, code `CONCURRENT_UPDATE`.
- Verifikasi: `npx tsc --noEmit` bersih, `npm run build` sukses. Test e2e QC belum dijalankan ulang (butuh DB `qc_consign_test`); regresi test belum ditambahkan.

## Perbaikan QC (BUG-001/003/004/005) - 2026-10-18
- BUG-001: `assertNoDraft` (src/lib/stock-opname.ts) mengunci baris `warehouses` FOR UPDATE di transaksi POST lalu cek DRAFT => 409 `DRAFT_EXISTS` + `details.opnameId`.
- BUG-003: finalize mengunci baris `stocks` (FOR UPDATE); `StockInsufficientError` saat penulisan dipetakan ke 409 `STOCK_CONFLICT` (bukan 400 `INSUFFICIENT_STOCK`).
- BUG-004/005: `summarize` memakai `appliedDiff` untuk item di-clamp; `unchangedItems` tidak lagi menghitung item clamped (stok sudah 0 masuk `clampedItems`).
- Tambahan: `categoryName` (header & item), `createdByName` (header). Kontrak + salinan pos-mobile diperbarui.
- Verifikasi: `npx tsc --noEmit` = 9 error lama (prices/units), 0 baru. Belum ada uji DB/otomatis; tidak ada migrasi baru (tanpa perubahan skema). 
- Catatan: DRAFT lama yang sudah dobel di data existing tidak dibersihkan otomatis.
