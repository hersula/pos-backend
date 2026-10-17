# Analisis Kelayakan & Rancangan Integrasi: Penjualan Konsinyasi

Tanggal: 2026-10-17. Penulis: analyst. Mode: read-only terhadap kode.

## 0. Batasan penting analisis ini (baca dulu)
- **Akses baca ke `C:\laragon\www\pos-backend` (termasuk `docs/analysis/codebase-map.md`, `prisma/schema.prisma`, `src/app/api/**`) TIDAK diizinkan** oleh sistem izin saat analisis ini dibuat. Saya tidak mengakalinya.
- Akibatnya semua klaim tentang backend di dokumen ini berstatus **ASUMSI/BELUM TERVERIFIKASI**, kecuali yang dikutip dari `pos-mobile/docs/analysis/codebase-map.md` (yang memuat daftar route backend hasil verifikasi sebelumnya) atau dari brief tugas manager (bug conversionQty saat retur stok, piutang tanpa jurnal).
- Klaim tentang mobile berstatus **FAKTA** (dibaca langsung dari `C:\laragon\www\pos-mobile\lib`).
- Bagian yang wajib diverifikasi backend sebelum eksekusi ditandai **[VERIFIKASI-BE]**.

## 1. Apakah konsep konsinyasi sudah ada?
| Lokasi | Hasil | Status |
|---|---|---|
| `pos-mobile/lib/**` (grep `consign|konsinyasi|titip`, case-insensitive) | **0 hasil** | FAKTA |
| `ApiEndpoints` (`lib/core/api/api_endpoints.dart`) | Tidak ada endpoint konsinyasi; ada `/stocks`, `/stock-movements` tanpa repo/layar | FAKTA |
| Route backend (daftar 62 route di peta mobile, bagian 4) | Tidak ada route berbau konsinyasi/transfer stok di daftar tersebut | FAKTA dari peta, tapi daftar itu tidak lengkap per-file |
| `schema.prisma` | Tidak bisa dibaca | [VERIFIKASI-BE]: `grep -in "consign\|konsinyasi\|titip\|transfer" prisma/schema.prisma src -r` |

Kesimpulan sementara: konsinyasi adalah **fitur baru sepenuhnya**, tidak ada sisa implementasi yang perlu dirujuk.

## 2. Tafsir yang dipilih: **(A) Konsinyasi keluar** (barang kita dititipkan ke customer/outlet)
### Alasan (berbasis model data yang ada)
| Aspek | Tafsir A (titip ke customer) | Tafsir B (jual titipan supplier) |
|---|---|---|
| Pihak lawan | `Customer` sudah dipakai di Sale (`customerId`), mobile punya `Customer` + `CustomerRepository` | `Supplier` hanya dipakai di PO; Sale tidak mengenal supplier |
| Stok | Stok tetap milik kita, hanya pindah lokasi. Cocok dengan stok per gudang (`warehouseId` di Sale & PO) | Butuh konsep kepemilikan stok per item (stok "bukan milik kita"), HPP & persediaan tidak boleh masuk neraca. Model stok sekarang tidak membedakan pemilik (asumsi) |
| Penjualan | Saat outlet lapor terjual, kita buat **Sale biasa** (piutang/CREDIT) -> memakai ulang seluruh logika `POST /sales` (harga, unit, conversionQty, HPP, jurnal penjualan) | Setiap Sale kasir harus memecah baris barang titipan untuk membentuk hutang ke supplier per item; mengubah alur kasir inti (`checkout_screen`, `SalesRepository.createSale`) |
| Piutang/pembayaran | `POST /sales/{id}/payments` sudah ada dan dipakai mobile (`SalesRepository.addPayment`) | Butuh hutang konsinyasi ke supplier; mirip `POST /purchase-orders/{id}/payments`, tapi nilai hutang baru diketahui setelah barang laku |
| Akunting | Jurnal = mutasi persediaan antar lokasi (tanpa jurnal, atau akun "Persediaan Konsinyasi") + jurnal Sale biasa saat settlement | Jurnal komisi/hutang konsinyasi, akun baru, pengecualian HPP |
| Dampak ke kode yang ada | **Additive** (model baru + endpoint baru; Sale dipakai ulang) | **Invasif** (mengubah Sale/SaleItem, kasir, laporan laba-rugi) |

**Rekomendasi: Tafsir A sebagai default.** Tafsir B lebih jarang untuk POS UMKM yang sudah punya modul Pengadaan (PO) dan piutang penjualan, serta jauh lebih berisiko karena menyentuh alur kasir yang setiap hari dipakai. B bisa jadi fase 2 bila pengguna memang menerima barang titipan supplier.

## 3. Titik masuk ke alur yang ada
### 3.1 Konsep inti: "gudang konsinyasi" per customer
Stok yang dititipkan dicatat sebagai stok di **Warehouse khusus bertipe `CONSIGNMENT`** yang terikat ke satu `customerId`. Dengan begitu:
- Kirim barang = **transfer stok** gudang toko -> gudang konsinyasi (StockMovement OUT + IN).
- Laporan terjual = **Sale biasa** dengan `warehouseId` = gudang konsinyasi dan `customerId` = outlet, metode bayar CREDIT (piutang) -> semua logika harga/HPP/jurnal Sale dipakai ulang.
- Retur sisa = transfer balik gudang konsinyasi -> gudang toko.
- Laporan stok per gudang otomatis menampilkan "barang di outlet X".

### 3.2 Tabel titik masuk
| Area | Dipakai ulang | Diubah / ditambah | Status |
|---|---|---|---|
| Stok per gudang | Model Stock (warehouseId, productId, qty dalam satuan dasar) | Kolom `Warehouse.type` (`STORE` default, `CONSIGNMENT`) + `Warehouse.customerId` nullable | [VERIFIKASI-BE] nama model/kolom |
| StockMovement | Model StockMovement yang ada | Enum tipe baru: `CONSIGN_OUT`, `CONSIGN_IN` (atau `TRANSFER_OUT/IN`), `CONSIGN_RETURN`, kolom `refType/refId` ke ConsignmentOrder | [VERIFIKASI-BE] apakah tipe berupa enum Prisma (perlu migrasi enum) atau string |
| Konversi satuan | `ProductUnit.conversionQty` (FAKTA mobile: 1 Dus = 24 Botol) | Simpan **snapshot `conversionQty` dan `baseQty`** di tiap ConsignmentItem saat dikirim; seluruh mutasi stok memakai `baseQty`, bukan `qty` | Wajib. **Bug terpetakan "conversionQty saat retur stok" (dari brief) tidak boleh terulang**: retur konsinyasi harus `qty * conversionQtySnapshot`. Sebaiknya bug di jalur cancel/retur Sale diperbaiki dulu karena settlement memakai Sale |
| Penjualan | Service/handler `POST /sales` (validasi produk, harga, unit, pengurangan stok, jurnal) | Ekstrak logika pembuatan Sale ke fungsi service yang bisa dipanggil dari endpoint settlement dalam **satu `prisma.$transaction`** | [VERIFIKASI-BE] apakah logika ada di route.ts langsung (perlu refactor ke `src/lib/...`) |
| Piutang | `Sale.paidTotal`, status `PARTIAL`, `POST /sales/{id}/payments` (FAKTA mobile: `Sale.outstanding`, `SalesRepository.addPayment`) | Tidak ada; pelunasan konsinyasi = pelunasan Sale hasil settlement | Bug terpetakan **"piutang tanpa jurnal"** (dari brief) berdampak langsung: settlement konsinyasi hampir selalu CREDIT, jadi tanpa perbaikan, seluruh omzet konsinyasi tidak terjurnal ke Piutang Usaha. **Harus diperbaiki sebelum/bersama fitur ini** |
| Jurnal akunting | Fungsi posting jurnal Sale & payment | Opsional: jurnal reklasifikasi `Persediaan Konsinyasi` (Dr) / `Persediaan` (Cr) saat kirim, dibalik saat retur/settlement. MVP boleh tanpa jurnal transfer (nilai persediaan total tetap sama) | Keputusan diambil: MVP **tanpa** jurnal transfer, akun konsinyasi masuk fase 2 |
| Laporan | `/reports/sales-summary`, `/profit-loss` | Sale hasil settlement otomatis ikut omzet/laba pada **tanggal settlement** (bukan tanggal kirim). Tambah `GET /reports/consignment` (posisi titipan per outlet) | Sesuai prinsip akuntansi konsinyasi: pendapatan diakui saat terjual |
| Role/otorisasi | Role OWNER, MANAGER, KASIR, GUDANG, AKUNTAN; `UserProfile.canManageInventory`, `canSell` (FAKTA mobile) | Lihat tabel endpoint (bagian 4.2) | Mobile hanya menyembunyikan menu; backend wajib cek role |
| Menu permission | `menuAccess` dengan 4 key (`kasir`, `inventori`, `laporan`, `pengaturan`), `kAllMenuKeys` di `user_profile.dart` | **Tidak menambah tab/menuKey baru** (MVP): pintu masuk konsinyasi diletakkan di tab Inventori, sejajar tombol Pengadaan (`product_list_screen.dart` baris ~105). Menghindari perubahan `/menu-permissions` dan seed | Keputusan diambil |
| Multi-tenant | Pola `tenantId` dari JWT pada setiap query | Semua model baru punya `tenantId` + index. **Setiap ID dari request (customerId, warehouseId sumber, productId, productUnitId, consignmentId) wajib divalidasi milik tenant** (`findFirst({where:{id, tenantId}})`), bukan `findUnique({id})` | [VERIFIKASI-BE] cek apakah route Sale/PO sudah melakukan ini; jika ada celah di sana, celah ikut terwariskan |
| Batas paket FREE | `FREE_LIMIT_REACHED` saat `POST /sales` (FAKTA mobile: `checkout_screen.dart` baris ~136) | Settlement membuat Sale, sehingga ikut terhitung kuota | Keputusan diambil: ikut dihitung (konsisten); mobile menampilkan dialog yang sama |

### 3.3 Temuan mobile yang berdampak
1. **`checkout_screen.dart` `_loadWarehouses()` memilih `list.first` sebagai gudang default.** Jika `GET /warehouses` ikut mengembalikan gudang konsinyasi, kasir bisa tanpa sadar menjual dari stok outlet. Mitigasi: `GET /warehouses` default hanya `type=STORE`; gudang konsinyasi diambil dengan `?type=CONSIGNMENT` atau via endpoint konsinyasi. Wajib masuk acceptance criteria.
2. Mobile tidak punya repo/layar stok (`/stocks`, `/stock-movements` hanya konstanta). Layar konsinyasi butuh stok tersedia per gudang untuk validasi qty kirim, jadi perlu `StockRepository` minimal.
3. Mobile tidak punya `CustomerRepository` untuk update/detail, hanya GET/POST (FAKTA peta). Cukup untuk memilih outlet.
4. Pola PO (`purchase_order_list/form/detail_screen`, `PurchaseOrderRepository` dengan `receive`/`payDebt`) adalah template terdekat untuk layar dokumen multi-langkah konsinyasi.
5. Tidak ada offline: semua langkah konsinyasi online, wajar karena bukan transaksi kasir.

## 4. Rancangan
### 4.1 Perubahan skema Prisma (semua additive)
```prisma
enum WarehouseType { STORE CONSIGNMENT }

model Warehouse {
  // kolom lama tetap
  type       WarehouseType @default(STORE)
  customerId String?
  customer   Customer?     @relation(fields: [customerId], references: [id])
  @@index([tenantId, type])
}

enum ConsignmentStatus { DRAFT SENT PARTIALLY_SETTLED SETTLED CANCELLED }

model ConsignmentOrder {
  id                 String   @id @default(cuid())
  tenantId           String
  consignmentNo      String            // KNS-YYYYMMDD-#### unik per tenant
  customerId         String
  sourceWarehouseId  String            // gudang toko asal
  consignWarehouseId String            // gudang CONSIGNMENT milik customer
  status             ConsignmentStatus @default(DRAFT)
  sentAt             DateTime?
  dueDate            DateTime?         // batas evaluasi/retur
  note               String?  @db.Text
  createdById        String
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  items              ConsignmentItem[]
  settlements        ConsignmentSettlement[]
  @@unique([tenantId, consignmentNo])
  @@index([tenantId, status])
  @@index([tenantId, customerId])
}

model ConsignmentItem {
  id                    String  @id @default(cuid())
  consignmentOrderId    String
  productId             String
  productUnitId         String?         // null = satuan dasar
  conversionQtySnapshot Int     @default(1)
  qtySent               Int             // dalam satuan yang dipilih
  baseQtySent           Int             // qtySent * conversionQtySnapshot
  baseQtySold           Int     @default(0)
  baseQtyReturned       Int     @default(0)
  agreedUnitPrice       Decimal @db.Decimal(15,2) // harga jual ke outlet per satuan terpilih
  @@index([consignmentOrderId])
}
// invarian: baseQtySold + baseQtyReturned <= baseQtySent

model ConsignmentSettlement {
  id                 String   @id @default(cuid())
  tenantId           String
  consignmentOrderId String
  type               String   // SALE | RETURN (atau enum)
  saleId             String?  @unique  // terisi bila type=SALE
  note               String?
  createdById        String
  createdAt          DateTime @default(now())
  lines              Json     // [{consignmentItemId, baseQty}] (atau tabel baris terpisah)
  @@index([tenantId, consignmentOrderId])
}
```
Tambahan: nilai enum StockMovement baru (`CONSIGN_OUT`, `CONSIGN_IN`, `CONSIGN_RETURN`) bila tipenya enum, plus `Sale.consignmentOrderId String?` (nullable, index) untuk penelusuran.

**Migrasi aman (MySQL):** `prisma migrate dev --create-only`, review SQL: hanya `CREATE TABLE`, `ALTER TABLE ADD COLUMN ... NULL/DEFAULT`, dan `ALTER TABLE MODIFY ENUM` dengan **menambah** nilai di akhir. Tidak ada drop/rename. Data lama: semua warehouse menjadi `STORE` lewat default. Backup DB sebelum `migrate deploy` di produksi.

### 4.2 Endpoint baru
Base `/api`. Semua butuh Bearer, tenant dari JWT, respons pola `{ data }` / `{ message, code }` (mengikuti yang dipakai mobile).

| Method & path | Request | Response | Role |
|---|---|---|---|
| GET `/consignments?status=&customerId=&page=` | - | list header + ringkasan (totalSent, totalSold, totalReturned, nilai sisa) | OWNER, MANAGER, GUDANG, AKUNTAN (baca) |
| POST `/consignments` | `{customerId, sourceWarehouseId, dueDate?, note?, items:[{productId, productUnitId?, qty, agreedUnitPrice}]}` | ConsignmentOrder DRAFT. Gudang CONSIGNMENT customer dibuat otomatis bila belum ada | OWNER, MANAGER, GUDANG |
| GET `/consignments/{id}` | - | detail + items (sisa per item) + settlements + sale terkait | sama dengan GET list |
| PUT `/consignments/{id}` | sama dengan POST | hanya status DRAFT | OWNER, MANAGER, GUDANG |
| POST `/consignments/{id}/send` | - | status SENT; transaksi: validasi stok sumber cukup (baseQty), StockMovement CONSIGN_OUT dari sumber + CONSIGN_IN ke gudang konsinyasi | OWNER, MANAGER, GUDANG |
| POST `/consignments/{id}/settle-sale` | `{lines:[{consignmentItemId, qty, unitPrice?}], discountType?, discountValue?, taxPercent?, payments?:[{method, amount, referenceNo?}]}` | `{consignment, sale}`; membuat Sale (warehouseId = gudang konsinyasi, customerId, `consignmentOrderId`), naikkan baseQtySold; tanpa payments = piutang penuh | OWNER, MANAGER, KASIR(?) - default OWNER, MANAGER |
| POST `/consignments/{id}/return` | `{lines:[{consignmentItemId, qty}], note?}` | consignment; StockMovement CONSIGN_RETURN gudang konsinyasi -> sumber, pakai `conversionQtySnapshot` | OWNER, MANAGER, GUDANG |
| POST `/consignments/{id}/cancel` | `{reason}` | hanya DRAFT, atau SENT tanpa settlement (stok dikembalikan penuh) | OWNER, MANAGER |
| GET `/reports/consignment?customerId=&dateFrom=&dateTo=` | - | posisi titipan per outlet & produk, umur titipan, piutang terkait | OWNER, MANAGER, AKUNTAN |
| GET `/warehouses?type=` (ubah) | default `STORE` | - | tetap |

Aturan transisi status otomatis setelah settle/return: semua item `sold+returned == sent` -> `SETTLED`; sebagian -> `PARTIALLY_SETTLED`. Pelunasan uang tidak memengaruhi status konsinyasi (dilacak di Sale).

### 4.3 Alur status
```
DRAFT --send--> SENT --settle-sale/return (sebagian)--> PARTIALLY_SETTLED --(semua item habis)--> SETTLED
  |               |
  +--cancel-->  CANCELLED (SENT hanya bila belum ada settlement; stok dibalik)
```
Pembatalan Sale hasil settlement (`POST /sales/{id}/cancel`) harus mengurangi `baseQtySold` dan mengembalikan stok ke **gudang konsinyasi** (bukan gudang toko). [VERIFIKASI-BE] logika cancel Sale yang ada; ini sekaligus titik bug conversionQty.

### 4.4 Dampak stok & akunting (MVP)
| Kejadian | Stok | Jurnal |
|---|---|---|
| Send | Toko -baseQty, Gudang konsinyasi +baseQty | Tidak ada (MVP); fase 2: Dr Persediaan Konsinyasi / Cr Persediaan |
| Settle-sale | Gudang konsinyasi -baseQty (oleh logika Sale) | Jurnal Sale yang ada: Dr Piutang/Kas, Cr Penjualan (+PPN), Dr HPP / Cr Persediaan. **Bergantung pada perbaikan bug piutang tanpa jurnal** |
| Payment | - | Jurnal payment yang ada: Dr Kas/Bank, Cr Piutang |
| Return | Gudang konsinyasi -baseQty, Toko +baseQty | Tidak ada (MVP) |

### 4.5 Perubahan mobile
| Jenis | File baru/diubah |
|---|---|
| Endpoint | `core/api/api_endpoints.dart`: `consignments`, `consignmentDetail(id)`, `consignmentSend/Settle/Return/Cancel(id)`, `reportConsignment` |
| Model | `data/models/consignment.dart`: `ConsignmentOrder`, `ConsignmentItem` (getter `baseQtyRemaining`, `displayUnit`), `ConsignmentSettlement`; pakai `parseInt/parseNum` |
| Repository | `data/repositories/consignment_repository.dart` (pola `PurchaseOrderRepository`); `StockRepository` minimal untuk stok per gudang |
| Layar | `features/consignment/consignment_list_screen.dart` (filter status), `consignment_form_screen.dart` (pilih outlet, gudang asal, produk+satuan; pola form PO dengan draft item), `consignment_detail_screen.dart` (aksi Kirim, Lapor Terjual, Retur, Batal sesuai status & role), `consignment_settle_sheet.dart` (input qty terjual per item, maks sisa; opsi bayar langsung) |
| Navigasi | Tombol "Konsinyasi" di app bar `inventory/product_list_screen.dart` (sejajar Pengadaan), terlihat bila `canManageInventory` |
| Role | `UserProfile`: tambah `bool get canManageConsignment => ['OWNER','MANAGER','GUDANG'].contains(role)` dan `canSettleConsignment => ['OWNER','MANAGER'].contains(role)` |
| Struk | Settlement menghasilkan `Sale` -> pakai ulang `ReceiptScreen(sale: ...)` & `ReceiptBuilder`. Surat jalan konsinyasi (cetak saat Send) = builder baru meniru `purchase_order_receipt_builder.dart` (Could) |
| Checkout | Pastikan `_loadWarehouses()` hanya menerima gudang STORE (bila backend tidak memfilter default, filter di mobile) |
| Laporan | Tab/section "Konsinyasi" di `reports_screen.dart` (Should) |
| State | Tidak perlu provider baru (konsisten dengan pola layar lain: `setState` + repo) |

## 5. Risiko, keputusan, dan bloker
### Risiko
| Risiko | Dampak | Mitigasi |
|---|---|---|
| Bug piutang tanpa jurnal (brief) | Omzet konsinyasi tidak tercatat di buku besar | Perbaiki dulu sebagai tugas prasyarat |
| Bug conversionQty saat retur/cancel (brief) | Stok gudang konsinyasi/toko salah saat retur atau cancel settlement | Perbaiki dulu; test kasus 1 Dus=24 |
| Logika Sale tidak bisa dipanggil ulang (ada di route.ts) | Duplikasi logika harga/HPP | Refactor ke service bersama sebelum endpoint settle |
| Gudang konsinyasi terpilih di kasir | Penjualan dari stok outlet | Filter `type=STORE` default + AC khusus |
| Validasi tenant pada ID | Kebocoran data lintas tenant | Validasi semua ID di request terhadap tenantId; test lintas tenant |
| Race condition stok saat send | Stok minus | Pengecekan & update stok di dalam `$transaction`, update kondisional (`qty >= x`) |
| Harga outlet berbeda dari harga eceran | Salah tagih | `agreedUnitPrice` disimpan per item saat draft; settle memakai harga itu kecuali di-override OWNER/MANAGER |

### Keputusan yang diambil (tanpa perlu bertanya)
Tafsir A; gudang konsinyasi per customer; pendapatan diakui saat settlement; MVP tanpa jurnal transfer persediaan; settlement ikut kuota FREE; menu di tab Inventori tanpa menuKey baru; settle hanya OWNER/MANAGER.

### MASALAH BLOKER: **TIDAK ADA bloker bisnis/teknis yang terlihat dari sisi mobile; ADA bloker proses (sementara)**
- Bloker proses: skema Prisma dan route backend **belum bisa diverifikasi** karena akses baca ke `pos-backend` ditolak/tidak diberikan. Sebelum backend mulai coding, harus dicek (oleh analyst setelah izin diberikan, atau oleh agent backend pada langkah 1): (a) nama model Stock/StockMovement/Warehouse dan apakah tipe movement berupa enum, (b) letak logika `POST /sales` & `/sales/{id}/cancel`, (c) status nyata dua bug di brief, (d) pola validasi tenant.
- Bila hasil cek sesuai asumsi, rancangan ini bisa dieksekusi langsung tanpa input pengguna.

### Pertanyaan ke pengguna (hanya yang mengubah hasil signifikan)
1. Apakah yang dimaksud memang **barang kita dititipkan ke toko/outlet lain** (A), bukan **menerima barang titipan supplier** (B)? Default dikerjakan A.
2. Siapa yang boleh mencatat "laporan terjual" dari outlet: hanya OWNER/MANAGER (default), atau KASIR juga?

## 6. Urutan kerja yang disarankan
1. **Analyst/backend (S):** verifikasi item [VERIFIKASI-BE] di bagian 5; perbarui dokumen ini bila asumsi meleset.
2. **Backend (M):** perbaiki bug conversionQty retur/cancel dan piutang tanpa jurnal + test.
3. **Backend (M):** refactor logika pembuatan Sale ke service yang dapat dipakai ulang dalam transaksi.
4. **Backend (S):** migrasi additive (WarehouseType, model Consignment*, enum movement, `Sale.consignmentOrderId`); `GET /warehouses` default STORE. Tulis kontrak di `docs/api-contract.md`.
5. **Backend (L):** endpoint `/consignments` (CRUD, send, settle-sale, return, cancel) + penyesuaian cancel Sale. **Mobile mulai paralel** setelah kontrak (langkah 4) disepakati: model, repository, layar list/form dengan mock.
6. **Mobile (L):** layar detail + aksi + settle sheet + filter gudang di checkout + role getter.
7. **Backend + mobile (M):** `GET /reports/consignment` dan section laporan; surat jalan cetak (Could).
8. **QC (M):** skenario: kirim 2 Dus (=48 dasar), lapor terjual 30 botol, retur 18 -> SETTLED; stok toko & outlet benar; Sale CREDIT terjurnal; cancel Sale settlement mengembalikan stok ke gudang konsinyasi; lintas tenant ditolak (404/403); kasir tidak melihat gudang konsinyasi.

Estimasi total: backend L, mobile L. Jalur kritis: langkah 2-3-5.
