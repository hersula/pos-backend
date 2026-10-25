# Analisis Kebutuhan — Quantix POS (fitur inti: Transaksi, Stok, Pelanggan)

Tanggal: 22-10-2026 · Analis (T1) · Status: draf untuk review manager
Pasangan dokumen: `docs/analysis/architecture.md` (diagram arsitektur). Rujukan fakta: `docs/analysis/codebase-map.md`,
`../Quantix POS/docs/analysis/codebase-map-backend.md` & `codebase-map-mobile.md` (22-10-2026).
Label: **[F]** fakta terverifikasi dari kode/skema · **[A]** asumsi · **[R]** rekomendasi.

> Konteks penting: ini **proyek brownfield**. Backend (Next.js 14 + Prisma + MySQL/MariaDB, 31 model, 67 route) dan
> aplikasi Flutter (Q-Pos) **sudah ada dan berjalan**. Jadi dokumen ini bukan spesifikasi dari nol, melainkan
> kebutuhan target + **analisis celah (gap)** terhadap yang sudah dibangun. Belum ada `docs/brief.md`/`docs/plan.md`;
> satu-satunya brief pengguna: "produk POS untuk UMKM, Frontend dan Backend terpisah" (`docs/ide-awal.md`).

---

## 1. Ringkasan masalah & tujuan bisnis
**Masalah:** UMKM (warung, toko kelontong, toko bangunan, distributor kecil) mencatat penjualan dan stok secara
manual/Excel, sehingga selisih kas, stok hilang, dan piutang pelanggan tidak terpantau.

**Tujuan bisnis sebenarnya** (bukan sekadar "punya aplikasi kasir"):
1. **Uang tidak bocor** — setiap rupiah yang masuk tercatat sekali, dengan harga yang benar, dan bisa direkonsiliasi per kasir/hari.
2. **Stok bisa dipercaya** — stok sistem = stok fisik (dengan opname), setiap perubahan punya jejak.
3. **Pelanggan & piutang terkelola** — tahu siapa berutang berapa, dan bisa menagih.
4. **Model SaaS berkelanjutan** — paket FREE (batas 10 transaksi/hari **[F]** `src/lib/subscription.ts:6`) → SUBSCRIBE.

**Indikator sukses yang diusulkan [R]:** 0 transaksi ganda per 10.000 transaksi; selisih stok opname < 1% SKU;
checkout ≤ 3 detik (p95) di jaringan 4G; ≥ 30% tenant FREE aktif upgrade dalam 60 hari.

## 2. Stakeholder & persona
| Persona | Kebutuhan utama | Kendala |
|---|---|---|
| **Owner UMKM** (role `OWNER`) | Laporan omzet/laba harian, kontrol kasir, stok menipis | Gaptek ringan, akses dari HP, sensitif biaya |
| **Kasir** (`KASIR`) | Checkout cepat (scan barcode), cetak struk Bluetooth, terima QRIS/tunai | Antrean, sinyal tidak stabil, HP Android low-end |
| **Staf gudang** (`GUDANG`) | Terima barang (PO), opname, transfer/konsinyasi | Barang banyak SKU & satuan (pcs/dus) |
| **Manajer/Akuntan** (`MANAGER`/`AKUNTAN`) | Jurnal, piutang/hutang, laba rugi | Butuh angka konsisten dengan kas |
| **Pelanggan akhir** | Struk jelas, utang tercatat benar | Data pribadi (nama, HP) → UU PDP |
| **Admin platform Quantix** (`SUPER_ADMIN`/`ADMIN_SUPPORT`) | Approve tenant, konfirmasi bayar langganan | Volume tenant tumbuh |

## 3. Status fitur saat ini (gap ringkas)
| Area | Sudah ada [F] | Celah utama [F] |
|---|---|---|
| Transaksi | `POST /sales` multi-metode bayar (CASH/DEBIT/CREDIT/QRIS/TRANSFER/EWALLET), diskon %/nominal, pajak, piutang (`PARTIAL`), cancel, level harga, satuan konversi, struk BT | Tanpa idempotensi (risiko transaksi ganda); harga & `taxPercent` bisa dikirim klien; nomor invoice dari `count()` (bentrok saat paralel); tanpa WIB eksplisit; pelunasan piutang paralel bisa ganda (BUG-008); `REFUNDED` tanpa alur; **tidak ada shift/kas laci**; tanpa offline |
| Stok | `Stock` per gudang, `StockMovement` IN/OUT/ADJUSTMENT/TRANSFER, PO terima barang, opname, konsinyasi, `minStock` | `quantity Int` → **tidak bisa jual pecahan (kg/liter/meter)**; barcode tidak unik; 4 tabel tanpa migrasi (`product_units`, `product_prices`, `price_levels`, `platform_settings`); FK lintas tenant belum dicek (`categoryId`, `warehouseId`); notifikasi stok menipis belum ada; mobile belum punya layar mutasi stok |
| Pelanggan | `Customer` (name?, phone?, email?), relasi ke sale & konsinyasi | Tidak ada alamat, catatan, batas kredit; phone tidak unik per tenant (duplikat); mobile belum bisa edit/hapus; tidak ada consent/penghapusan data (UU PDP); belum ada riwayat & saldo piutang per pelanggan sebagai endpoint |

## 4. User stories & acceptance criteria
Kode: **TRX** transaksi, **STK** stok, **CUS** pelanggan, **NFR** lintas. Kolom "Status" = kondisi kode saat ini.

### 4.1 Transaksi
**TRX-01 Checkout aman dari dobel** (Must, status: belum)
Sebagai kasir, saya ingin menekan "Bayar" lagi saat koneksi lambat tanpa takut tercatat dua kali, agar kas dan stok tidak selisih.
- Given aplikasi mengirim `POST /api/sales` dengan `clientRef` UUID X dan server sudah menyimpannya, When request yang sama dengan `clientRef` X dikirim ulang, Then server mengembalikan **200 dengan sale yang sama** (bukan 201 baru), stok hanya berkurang sekali, jumlah baris `sales` dengan `clientRef` X = 1.
- Given dua request bersamaan dengan `clientRef` sama, When diproses paralel, Then tepat satu tersimpan; yang lain mendapat sale yang sama atau 409, tidak pernah 500.

**TRX-02 Harga ditentukan server** (Must, status: belum)
Sebagai owner, saya ingin harga jual dan pajak diambil dari master produk/level harga, agar kasir/klien termodifikasi tidak bisa menjual di bawah harga.
- Given produk A `sellPrice` 15.000 dan level harga "Grosir" 13.500, When kasir checkout dengan level Grosir dan body berisi `unitPrice: 0`, Then sale tersimpan dengan `unitPrice` 13.500 (nilai klien diabaikan) **atau** ditolak 422.
- Given user role `KASIR`, When mengirim override harga, Then 403; Given role `OWNER`/`MANAGER` dengan `priceOverrideReason`, Then diterima dan tercatat di audit (user, harga lama/baru, waktu).
- `taxPercent` diambil dari pengaturan tenant, bukan body.

**TRX-03 Nomor invoice unik & berbasis WIB** (Must, status: sebagian)
- Given 20 checkout paralel pada tenant yang sama, When selesai, Then 20 invoice unik berurutan tanpa celah dan tanpa error 500.
- Given transaksi pukul 23.30 WIB (16.30 UTC), Then nomor invoice dan laporan harian masuk **tanggal WIB hari itu**, bukan tanggal UTC.

**TRX-04 Multi-pembayaran & kembalian** (Must, status: ada — perlu uji regresi)
- Given total 87.500, When dibayar QRIS 50.000 + tunai 50.000, Then `paidTotal` 100.000, `changeAmount` 12.500, status `PAID`; kembalian hanya boleh dari porsi tunai (bila tunai < kembalian → 422).
- QRIS/TRANSFER/DEBIT wajib `referenceNo` (≥ 4 karakter) [R].

**TRX-05 Penjualan piutang & pelunasan** (Must, status: ada, bug BUG-008)
- Given sale `PARTIAL` sisa 40.000, When dua pelunasan 40.000 dikirim paralel, Then tepat satu sukses, yang lain 409, jurnal hanya satu.
- Given pelunasan melebihi sisa, Then 422.
- Penjualan piutang wajib `customerId` milik tenant yang sama.

**TRX-06 Batal & retur** (Should, status: batal ada, retur belum)
- Given sale `PAID` hari ini, When owner/manager membatalkan dengan alasan, Then status `CANCELLED`, stok kembali sesuai `conversionQty`, jurnal pembalik dibuat; KASIR → 403.
- Retur sebagian (Should): Given sale 3 item, When 1 item diretur, Then stok item itu bertambah, refund tercatat sebagai `SalePayment` negatif/entitas `SaleReturn`, status `REFUNDED` hanya bila seluruh item diretur.

**TRX-07 Shift & rekap kas** (Should, status: belum ada model)
Sebagai owner, saya ingin kasir membuka/menutup shift dengan modal awal dan setoran akhir, agar selisih kas per kasir terlihat.
- Given shift dibuka dengan modal 200.000 dan penjualan tunai 1.500.000, When ditutup dengan uang fisik 1.690.000, Then laporan menampilkan ekspektasi 1.700.000 dan **selisih −10.000**.
- Checkout tanpa shift terbuka → 409 (bila fitur shift diaktifkan tenant).

**TRX-08 Struk** (Must, status: ada) — struk BT 58/80 mm memuat nama toko, invoice, tanggal WIB `dd/MM/yyyy HH:mm`, item, diskon, pajak, metode bayar, kembalian; cetak ulang tersedia dari riwayat.

**TRX-09 Kuota paket FREE** (Must, status: ada) — Given tenant FREE sudah 10 transaksi hari ini (WIB), When transaksi ke-11, Then 402/403 dengan pesan ajakan upgrade; tenant SUBSCRIBE aktif tidak dibatasi.

### 4.2 Stok
**STK-01 Stok terpotong atomik saat jual** (Must, status: ada) — Given stok 5, When dua checkout 3 unit paralel, Then satu sukses dan satu 409 "stok tidak cukup" (kecuali tenant mengizinkan stok minus), stok akhir tidak pernah < 0.

**STK-02 Jejak mutasi** (Must, status: ada di backend, UI mobile belum)
- Setiap perubahan `Stock.quantity` punya tepat satu `StockMovement` dengan `referenceType` (SALE/PURCHASE/MANUAL/TRANSFER/OPNAME/CONSIGNMENT) dan `createdBy`.
- Given filter produk + rentang tanggal WIB, Then kartu stok menampilkan saldo awal, masuk, keluar, saldo akhir yang cocok dengan `Stock.quantity`.

**STK-03 Satuan bertingkat & pecahan** (Must untuk satuan bertingkat — ada; Should untuk pecahan — belum)
- Given produk dasar pcs, 1 dus = 24 pcs, When jual 2 dus, Then stok berkurang 48 pcs, `SaleItem.conversionQty` = 24 tersimpan sebagai snapshot.
- Given produk "Beras" satuan kg, When jual 1,5 kg, Then diterima (butuh `quantity` → `DECIMAL(14,3)`). **Saat ini mustahil karena `Int`.**

**STK-04 Barcode unik & scan** (Must) — Given barcode `8991234567890` sudah dipakai produk A di tenant T, When produk B dibuat dengan barcode sama di T, Then 422; di tenant lain diizinkan. `GET /products/scan?code=` mengembalikan produk + satuan yang cocok ≤ 300 ms.

**STK-05 Penerimaan barang (PO)** (Must, status: ada) — Given PO `DRAFT` 10 dus, When diterima, Then stok +240 pcs, `costPrice` diperbarui sesuai kebijakan (rata-rata tertimbang [R]), hutang tercatat bila `CREDIT`.

**STK-06 Stock opname** (Must, status: ada) — Given opname final, Then selisih menjadi `ADJUSTMENT` dan jurnal; opname tidak bisa difinalisasi dua kali.

**STK-07 Peringatan stok menipis** (Should, status: belum) — Given `minStock` 10 dan stok jadi 9, Then produk muncul di daftar "stok menipis" dashboard; notifikasi WA ke owner (Could).

**STK-08 Isolasi tenant** (Must, status: sebagian) — Given `categoryId`/`warehouseId`/`supplierId` milik tenant lain, When dipakai di request, Then 404/422, tidak pernah tersimpan.

### 4.3 Pelanggan
**CUS-01 CRUD pelanggan** (Must, status: backend ada, mobile belum edit/hapus)
- Nama wajib (min 2 karakter) untuk pelanggan yang dipakai di piutang; HP format Indonesia dinormalisasi ke `+62…`; Given HP sama sudah ada di tenant, Then 422 dengan tautan ke pelanggan yang ada.
- Hapus pelanggan yang punya piutang/riwayat → soft delete (nonaktif), bukan hapus fisik.

**CUS-02 Cari & pilih pelanggan di kasir** (Must) — pencarian nama/HP ≤ 500 ms untuk 5.000 pelanggan, bisa tambah cepat dari layar checkout.

**CUS-03 Saldo piutang & riwayat** (Must, status: belum ada endpoint khusus) — Given pelanggan punya 3 sale `PARTIAL`, Then `GET /customers/{id}` menampilkan total piutang = Σ(grandTotal − paidTotal), daftar transaksi, umur piutang (0–30, 31–60, > 60 hari).

**CUS-04 Batas kredit** (Should) — Given limit 1.000.000 dan piutang 900.000, When checkout piutang 200.000, Then ditolak 422 kecuali owner override.

**CUS-05 Level harga default pelanggan** (Could) — pelanggan "Grosir" otomatis memakai level harga Grosir saat dipilih.

**CUS-06 Privasi data pelanggan (UU PDP No. 27/2022)** (Must) — data pelanggan hanya bisa dilihat role berizin; owner bisa mengekspor dan **menganonimkan** data pelanggan atas permintaan (nama/HP diganti, transaksi tetap untuk akuntansi); nomor HP tidak dicetak di log server.

**CUS-07 Loyalti/poin** (Won't untuk MVP).

## 5. Prioritas MoSCoW (MVP rilis berikutnya)
| Prioritas | Item |
|---|---|
| **Must** | TRX-01, 02, 03, 04, 05, 08, 09 · STK-01, 02 (backend), 03 (bertingkat), 04, 05, 06, 08 · CUS-01, 02, 03, 06 · **prasyarat keamanan**: tutup `admin/send-whatsapp` + rotasi kredensial WA, migrasi 4 tabel yang hilang, hapus fallback JWT secret |
| **Should** | TRX-06 (retur), TRX-07 (shift), STK-03 (pecahan), STK-07, CUS-04, rate limit login, secure storage token di mobile, UI kartu stok di mobile |
| **Could** | CUS-05, notifikasi WA stok menipis, ekspor Excel laporan, multi-outlet dashboard |
| **Won't (MVP)** | Loyalti/poin, integrasi payment gateway QRIS dinamis, e-Faktur/Coretax, marketplace sync, **offline-first penuh** (menunggu jawaban Q1) |

## 6. Kebutuhan non-fungsional
| Kategori | Kebutuhan terukur |
|---|---|
| Performa | `POST /sales` p95 ≤ 800 ms server-side (≤ 3 dtk end-to-end 4G); scan barcode ≤ 300 ms; daftar dipaginasi (default 20, maks 100) — saat ini hanya 6 route berpaginasi [F] |
| Konsistensi data | Semua operasi uang/stok dalam satu transaksi DB; update bersyarat/`SELECT … FOR UPDATE`; uang `DECIMAL(14,2)`, tidak pernah float |
| Keamanan | JWT secret wajib di produksi (start gagal bila kosong); refresh token dirotasi & bisa dicabut; rate limit 5 login gagal/15 mnt per IP+email; validasi zod di **semua** route (kini 37/67 [F]); cek kepemilikan tenant di setiap FK; upload cek magic bytes; HTTPS wajib |
| Otorisasi | `menu-permissions` di-enforce di server, bukan hanya UI; status user/tenant dicek saat refresh |
| Ketersediaan | Target 99,5%/bulan; backup DB harian + uji restore bulanan; RPO 24 jam, RTO 4 jam [A untuk skala awal] |
| Skalabilitas | Desain untuk 1.000 tenant × 300 transaksi/hari (≈ 300 rb sale/hari) di satu instance MariaDB dengan indeks `(tenant_id, created_at)` |
| Lokalisasi | Bahasa Indonesia; Rupiah `Rp 1.250.000` (tanpa desimal di UI); zona waktu **Asia/Jakarta (WIB)** eksplisit untuk batas hari, invoice, laporan, kuota FREE; tanggal `dd/MM/yyyy`; API memakai ISO-8601 dengan offset |
| Aksesibilitas | Target sentuh ≥ 48 dp, kontras WCAG AA, ukuran teks bisa diperbesar (pengguna 40+ tahun) |
| Kepatuhan | UU PDP (consent, hak hapus/anonim, minimisasi data, pemberitahuan bila bocor); simpan data transaksi ≥ 10 tahun untuk keperluan pajak (UU KUP) [A]; PPN default 11% [F] — perlu konfigurasi per tenant (banyak UMKM non-PKP = 0%) |
| Observabilitas | Log terstruktur dengan `requestId`, `tenantId` (tanpa PII); error tracking (mis. Sentry); health check `/api/health` |
| Kompatibilitas | Android 8+ (minSdk 26), HP RAM 2 GB; printer BT ESC/POS 58/80 mm |

## 7. Model data (target, fokus fitur inti)
Skema saat ini sudah memadai sebagai fondasi (31 model). Perubahan yang diusulkan **[R]** (tandai ⊕ baru, Δ ubah):

| Entitas | Atribut kunci | Relasi |
|---|---|---|
| `Tenant` | id, name, status, planType, **Δ timezone (default `Asia/Jakarta`), Δ taxPercentDefault, Δ allowNegativeStock** | 1–N semua entitas |
| `User` | id, tenantId, role, email, isActive, **Δ tokenVersion** | N–1 Tenant |
| `Product` | id, tenantId, sku, barcode **Δ unique(tenantId, barcode)**, unit, costPrice, sellPrice, minStock | 1–N ProductUnit, ProductPrice, Stock |
| `ProductUnit` | label, conversionQty, barcode | N–1 Product |
| `Warehouse` | type STORE/CONSIGNMENT | 1–N Stock |
| `Stock` | productId+warehouseId (unique), **Δ quantity DECIMAL(14,3)** | |
| `StockMovement` | type, qty Δ DECIMAL, referenceType/Id, createdBy | jejak audit stok |
| `Customer` | name, phone **Δ normalisasi + unique(tenantId, phone) bila tidak null**, email, **Δ address, note, creditLimit, defaultPriceLevelId, isActive, anonymizedAt** | 1–N Sale |
| `Sale` | invoiceNo unique, **⊕ clientRef unique(tenantId, clientRef)**, **⊕ shiftId**, subtotal, discount, tax, grandTotal, paidTotal, status | 1–N SaleItem, SalePayment |
| `SaleItem` | qty Δ DECIMAL, unitPrice (dari server), conversionQty snapshot, **⊕ priceOverrideBy/Reason** | |
| `SalePayment` | method, amount, referenceNo | |
| ⊕ `CashShift` | id, tenantId, warehouseId, userId, openedAt, openingCash, closedAt, closingCash, expectedCash, note | 1–N Sale |
| ⊕ `SaleReturn` + `SaleReturnItem` | saleId, items, refundAmount, reason, createdBy | N–1 Sale |
| ⊕ `DocumentCounter` | tenantId, docType (INV/PO/RET), period (yyyyMMdd WIB), lastNo — unique(tenantId, docType, period) | penomoran aman paralel |
| ⊕ `AuditLog` | tenantId, userId, action, entity, entityId, before/after JSON, createdAt | override harga, batal, hapus |

ERD inti (Mermaid) ada di `architecture.md` §4.

## 8. Rekomendasi arsitektur & tech stack
Fakta: stack terpasang Next.js 14 (API Route Handlers) + Prisma 5 + MySQL/MariaDB + Flutter 3.47 (provider, dio). Pengguna tidak meminta ganti stack.

| Opsi | Ringkasan | Kelebihan | Kekurangan |
|---|---|---|---|
| **A. Pertahankan & keraskan monolit modular Next.js** | Tetap satu app Next.js (API + admin web), rapikan lapisan: route → service (`src/lib/*`) → Prisma; tambah middleware auth/rate-limit, helper error, CI | Nol biaya migrasi, tim & e2e sudah ada, deploy sederhana (1 proses Node + MariaDB) | Next.js bukan framework API murni (tanpa DI/queue bawaan); perlu disiplin struktur |
| B. Migrasi backend ke Laravel 11 (sesuai profil stack tim) | Tulis ulang 67 route ke Laravel + Sanctum, skema dipertahankan | Ekosistem lengkap (queue, policy, rate limit, test), selaras dengan skill tim | Rewrite ±L–XL (6–10 minggu), risiko regresi pada logika uang/stok/jurnal, membekukan fitur |
| C. Pecah jadi layanan (NestJS API + Next.js admin) | API terpisah dari admin panel | Pemisahan jelas, skalabel per layanan | Kompleksitas ops naik, tidak diperlukan pada skala UMKM saat ini |

**Rekomendasi: Opsi A.** Alasan: masalah utama saat ini adalah **integritas data dan keamanan**, bukan framework.
Rewrite (B) menunda perbaikan yang mendesak (transaksi ganda, harga dari klien, kredensial bocor) dan menambah risiko
pada modul paling sensitif. Tinjau ulang opsi B bila (a) butuh antrean/job berat (sinkron offline, notifikasi massal)
atau (b) tim backend sepenuhnya berbasis PHP. Pemisahan admin panel ke proyek sendiri (sebagian C) bisa dilakukan
nanti tanpa mengubah API. Detail diagram & keputusan: `architecture.md`.

## 9. Risiko & mitigasi
| # | Risiko | Jenis | Dampak | Mitigasi |
|---|---|---|---|---|
| R1 | Transaksi/pelunasan ganda (tanpa idempotensi, BUG-008) | Teknis/finansial | Tinggi | TRX-01, TRX-05; e2e paralel di CI |
| R2 | Kredensial gateway WA bocor di git + route tanpa auth | Keamanan | Tinggi | Tutup route, **rotasi kredensial sekarang**, scan secret (gitleaks) di CI |
| R3 | Migrasi DB tidak lengkap → instalasi baru gagal | Teknis/jadwal | Tinggi | Migrasi penyusul via `prisma migrate diff`, uji di DB kosong di CI |
| R4 | Ubah `Int` → `DECIMAL` untuk qty memengaruhi stok, jurnal, opname, mobile | Teknis | Sedang | Lakukan bertahap: kolom baru + backfill + flag per produk `allowDecimalQty`; uji regresi e2e |
| R5 | Sinyal buruk di toko → kasir berhenti (tanpa offline) | Bisnis | Sedang–Tinggi | Jangka pendek: idempotensi + retry otomatis + antrean kecil di HP; jangka panjang: offline-first (keputusan Q1) |
| R6 | Ketergantungan gateway WA pihak ketiga (tidak resmi) | Pihak ketiga | Sedang | Abstraksi `NotificationProvider`, fallback email, jangan jadikan alur kritis bergantung WA |
| R7 | Kebocoran data antar tenant (FK tidak dicek) | Keamanan/PDP | Tinggi | Helper `assertOwned(tenantId, model, id)` wajib, test otorisasi lintas tenant |
| R8 | Token plaintext di SharedPreferences + refresh 30 hari tanpa revoke | Keamanan | Sedang | `flutter_secure_storage`, rotasi refresh, `tokenVersion` |
| R9 | Tidak ada CI/test runner → regresi tak terdeteksi | Jadwal/kualitas | Sedang | GitHub Actions: tsc, build, e2e + service MariaDB; `flutter analyze/test` |
| R10 | PPN 11% default untuk UMKM non-PKP → struk & laporan salah | Kepatuhan | Sedang | Pajak dikonfigurasi per tenant, default 0% saat onboarding dengan pertanyaan "PKP?" |

## 10. Asumsi
1. [A] Target pasar: UMKM ritel 1–3 outlet, 1–5 kasir, ≤ 5.000 SKU, ≤ 300 transaksi/hari per outlet.
2. [A] Klien utama kasir adalah aplikasi Flutter Android; admin panel web hanya untuk admin platform Quantix (bukan back-office tenant).
3. [A] Pembayaran QRIS/EDC memakai perangkat milik merchant (statis); sistem hanya mencatat referensi, tanpa integrasi gateway.
4. [A] Skema DB & API yang ada dipertahankan; perubahan bersifat aditif dan kompatibel dengan versi app terpasang (field baru opsional dulu).
5. [A] Satu DB bersama multi-tenant (`tenant_id` di setiap tabel) tetap dipakai.

## 11. Pertanyaan kritis untuk pengguna (maks. 3)
1. **Apakah kasir wajib tetap bisa berjualan saat internet putus?** Ya → perlu DB lokal (Drift/SQLite) + outbox + sinkronisasi dan resolusi konflik stok (ukuran L, +3–4 minggu). Tidak → cukup idempotensi + retry (ukuran S).
2. **Apakah ada tenant yang menjual barang curah (kg/liter/meter)?** Ya → migrasi qty ke DECIMAL masuk Must (ukuran M, menyentuh stok/opname/konsinyasi/mobile).
3. **Apakah back-office tenant (owner) juga dibutuhkan versi web (laptop), atau cukup di aplikasi HP?** Menentukan apakah perlu frontend web tenant baru (L) atau cukup memperluas Flutter.

## 12. Estimasi kompleksitas & urutan pengerjaan
| Urutan | Paket | Ukuran | Ketergantungan |
|---|---|---|---|
| 0 | **Prasyarat keamanan & fondasi**: tutup `send-whatsapp` + rotasi kredensial, `.env.example` placeholder, migrasi 4 tabel hilang, hapus fallback JWT, `postinstall prisma generate`, CI dasar (tsc+build) | M | — |
| 1 | Helper bersama: `withAuth`, format error `{message, code, errors}`, `assertOwned`, zona waktu WIB util | M | 0 |
| 2 | TRX-01 idempotensi `clientRef` (backend + mobile) | S | 1 |
| 3 | TRX-02 harga/pajak dari server + audit override | M | 1 |
| 4 | TRX-03 `DocumentCounter` + WIB | S | 1 |
| 5 | TRX-05 pelunasan bersyarat (sales & PO) | S | 1 |
| 6 | STK-04 unique barcode (+ skrip cek duplikat data lama), STK-08 isolasi FK | S | 1 |
| 7 | CUS-01/02/03 pelanggan: field baru, normalisasi HP, endpoint saldo piutang, layar edit/hapus di mobile | M | 1 |
| 8 | CUS-06 anonimisasi + pembatasan akses + hapus PII dari log | S | 7 |
| 9 | STK-02 UI kartu stok di mobile, STK-07 stok menipis | M | 1 |
| 10 | TRX-07 shift kas | M | 2, 4 |
| 11 | TRX-06 retur sebagian | M | 3, 4 |
| 12 | STK-03 qty pecahan (bila Q2 = ya) | M | 6, 9 |
| 13 | Offline-first (bila Q1 = ya) | L | 2 |

Paralel yang aman: paket 2–6 bisa dikerjakan bersamaan setelah paket 1; frontend mobile (paket 7, 9) paralel dengan backend bila kontrak API ditulis dulu di `docs/api-contract.md`.
