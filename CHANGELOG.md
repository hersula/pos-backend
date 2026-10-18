# Changelog

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/). Versi belum dirilis, jadi seluruh perubahan ada di `[Unreleased]`.

## [Unreleased]

### Added
- Modul Stock Opname: endpoint `/api/stock-opnames` (daftar, buat, detail, `PATCH /{id}/items`, `finalize`, `cancel`). Finalisasi membuat `StockMovement` `ADJUSTMENT` (`referenceType STOCK_OPNAME`) dengan selisih relatif ke stok saat finalisasi; opsi `clampToZero` untuk `STOCK_CONFLICT`. Kontrak di `docs/api-contract.md`.
- Migrasi `20261018000000_add_stock_opname` (additive: tabel `stock_opnames`, `stock_opname_items`). **Belum diterapkan** ke database mana pun; jalankan `npx prisma migrate deploy` saat rilis.
- Skrip e2e `tests/stock-opname-e2e.mjs` (belum dijalankan di DB `qc_opname_test`).
- Modul Konsinyasi (barang titip ke customer/outlet): endpoint `/api/consignments` (CRUD draf, send, settle-sale, return, cancel) dan `/api/consignments/outlet-stock`. Kontrak di `docs/api-contract.md`.
- Gudang konsinyasi otomatis per customer (`Warehouse.type = CONSIGNMENT`).
- Migrasi `20261017000000_add_consignment` (additive: tabel `consignment_orders`, `consignment_items`, `consignment_settlements`, kolom `warehouses.type`, `warehouses.customer_id`, `sales.consignment_order_id`). **Belum diterapkan** ke database mana pun.
- Dokumentasi: `docs/manual/konsinyasi.md`, bagian Konsinyasi di `README.md`.

### Changed
- `GET /api/warehouses` default hanya mengembalikan gudang `STORE`. Query baru `type=STORE|CONSIGNMENT|ALL`. Setiap gudang kini memuat `type` dan `customerId`.
- `POST /api/sales` menolak `warehouseId` bertipe `CONSIGNMENT` (400, `code: CONSIGNMENT_WAREHOUSE`).
- `POST /api/sales` memvalidasi `customerId` milik tenant yang sama (404 bila tidak).
- `POST /api/stock-movements` dan `POST /api/purchase-orders` menolak gudang konsinyasi (400, `code: CONSIGNMENT_WAREHOUSE`).
- `PUT` dan `DELETE /api/warehouses/{id}` pada gudang konsinyasi menghasilkan 409.
- Logika pembuatan Sale dipindah ke `src/lib/sale-service.ts` agar bisa dipakai ulang oleh settle-sale.
- Pengurangan stok (`adjustStock`) memakai update bersyarat agar stok tidak negatif saat transaksi paralel.

### Fixed
- Stock Opname (QC putaran 1): `DRAFT_EXISTS` aman terhadap request paralel (kunci baris gudang); stok dikunci saat finalisasi dan kekurangan stok dipetakan ke 409 `STOCK_CONFLICT`; ringkasan memakai `appliedDiff` untuk item yang di-clamp; `unchangedItems` tidak lagi menghitung item clamped. Respons menambah `categoryName` dan `createdByName`.
- `POST /api/sales/{id}/cancel`: stok dikembalikan `qty x conversionQty` (sebelumnya hanya `qty`, sehingga stok kurang saat satuan dus/karton dipakai).
- `POST /api/sales/{id}/cancel`: jurnal pelunasan piutang (`SALE_PAYMENT`) ikut dibalik. Cancel tidak bisa dijalankan dua kali secara paralel.
- `POST /api/sales/{id}/payments`: pelunasan piutang kini membuat jurnal `SALE_PAYMENT` (Dr Kas/Bank, Cr Piutang Usaha) sebesar `min(amount, sisa piutang)`. Sebelumnya buku besar tidak berubah.
- Pembayaran paralel pada sales dan purchase-orders menghasilkan 409 `CONCURRENT_UPDATE` (sebelumnya konflik transaksi tidak ditangani khusus).
- Transaksi konsinyasi memakai timeout 20 detik.

### Known issues
- Stock Opname belum diuji dinamis (tanpa DB uji, e2e belum dijalankan). Ada 9 error TypeScript lama di `products/[id]/prices|units` dan `lib/units.ts` yang membuat `npm run build` gagal; bukan bagian modul ini.
- BUG-004: riwayat migrasi tidak lengkap terhadap `schema.prisma` (drift pre-existing). Jalankan `npx prisma migrate status` terhadap database target sebelum deploy. Detail di `docs/manual/konsinyasi.md`.
- Pelunasan piutang lama (sebelum perbaikan jurnal) belum punya jurnal. Backfill belum diputuskan.
