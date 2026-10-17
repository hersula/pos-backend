# QC Regresi Putaran 2 (konsinyasi) - 2026-10-17

**HASIL: GAGAL** (1 bug Tinggi terbuka: BUG-008). BUG-001 dan BUG-003 TERTUTUP, BUG-002 SEBAGIAN.

## Lingkungan
Server `next start -p 3999` hasil `npm run build`, DB uji `qc_consign_test` dipakai ulang (perintah hapus database diblokir hook, jadi tidak dibuat ulang; `prisma migrate status`: up to date). `npx tsc --noEmit` bersih, `npm run build` sukses.

## Hasil test
- `tests/consignment-e2e.mjs` (+14 kasus regresi baru): run 1 = 132 lulus / 1 gagal. Diulang 3x: gagal 0, 0, 1 (flaky karena race nyata).
- `tests/consignment-bulk.mjs` (200 baris): create 334 ms, send 2861 ms, settle 3035 ms, semua sukses; tanpa error timeout di log.

## Status bug
| ID | Severity | Pemilik | Ringkasan | Status |
|---|---|---|---|---|
| BUG-001 | Sedang | backend | stock-movements/purchase-orders menerima gudang CONSIGNMENT | TERTUTUP: 400 CONSIGNMENT_WAREHOUSE (IN, OUT, PO), stok tak berubah, gudang STORE tetap normal |
| BUG-002 | Tinggi | backend | pembayaran paralel 500 | SEBAGIAN: tidak ada 500, kalah-balapan = 409 CONCURRENT_UPDATE; PO paralel 4x selalu tepat 1 sukses. Lihat BUG-008 |
| BUG-003 | Rendah | backend | timeout transaksi konsinyasi | TERTUTUP: send 40 item 684 ms, bulk 200 baris ~3 dtk, tanpa timeout |
| BUG-008 | Tinggi | backend | Pembayaran piutang Sale paralel bisa sukses ganda (lost update + jurnal ganda) | BARU, TERBUKA |

## BUG-008 detail
- Repro: settle-sale konsinyasi (grandTotal 106560), kirim 5 `POST /sales/{id}/payments` paralel (CASH, amount = grandTotal). Terjadi di 2 dari 4 run (status `[409,200,409,409,200]`).
- Diharapkan: tepat 1 sukses, sisanya 409. Aktual: 2x 200. DB: `sale_payments` 2 baris (total 213120), `sales.paid_total` = 106560 (tertimpa), jurnal `SALE_PAYMENT` 2 entri total 213120 padahal piutang hanya 106560 (Kas dobel, Piutang dikredit dobel, saldo piutang negatif). Jurnal tetap balance sehingga tidak terdeteksi.
- Penyebab: `src/app/api/sales/[id]/payments/route.ts` (blok `$transaction`, ~baris 28-60) membaca ulang `fresh` tanpa kunci baris; pada REPEATABLE READ snapshot masih PARTIAL dan `update` hanya menunggu lock lalu menimpa.
- Saran: klaim bersyarat seperti di cancel: `updateMany({where:{id, status:"PARTIAL", paidTotal: fresh.paidTotal}})` lalu 409 bila count 0, atau `SELECT ... FOR UPDATE` pada baris sale sebelum membaca; terapkan juga pada payments PO.
- Test: `tests/consignment-e2e.mjs`, kasus "BUG-002 sale paralel: tepat 1 sukses, sisanya 409".

## Catatan
Log server memuat `prisma:error` P2034 (36x) sebagai konsekuensi 409 yang ditangani, bukan 500. BUG-004..007 tidak diuji ulang di putaran ini.
