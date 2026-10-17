# Peta Codebase: pos-backend

Tanggal: 2026-10-17. Metode: baca file nyata (package.json, schema.prisma, seluruh `route.ts`, `src/lib/*`). Tidak ada install/migrasi/dev server yang dijalankan; `.env` asli tidak dibaca (file `.env` memang tidak ada di folder). Semua isi di bawah adalah **fakta terverifikasi dari kode** kecuali ditandai *Asumsi*.

## 1. Stack, script, titik masuk, konfigurasi

| Item | Nilai |
|---|---|
| Framework | Next.js `^14.2.13` (App Router, `src/app`), React `^18.3.1`, TypeScript `^5.6.2` (strict) |
| ORM / DB | Prisma `^5.20.0` (`@prisma/client`), provider **MySQL** |
| Auth | `jsonwebtoken ^9`, `bcryptjs ^2.4` (cost 10) |
| Validasi | `zod ^3.23.8` |
| Dev tool | `tsx ^4.19` (seed), eslint via `next lint` (tidak ada config eslint di repo, *belum terverifikasi jalan*) |
| Package manager | npm (`package-lock.json`); `node_modules` belum terpasang |
| Alias path | `@/*` -> `./src/*` (tsconfig) |
| `next.config.js` | hanya `reactStrictMode: true` |
| Deploy hint | URL APK `pos-backend.sicerdiq.my.id` di `/api/version`; tidak ada Dockerfile/CI/`ecosystem`/`middleware.ts` |

Script (`package.json`): `dev` (`next dev`), `build`, `start`, `lint`, `prisma:generate`, `prisma:migrate` (`prisma migrate dev --name init`, nama migrasi hard-coded "init"), `prisma:studio`, `seed` (`tsx prisma/seed.ts`). **Tidak ada script `test`.**

Cara jalan (dari README, sesuai script): `npm install` -> salin `.env.example` ke `.env` -> buat DB MySQL kosong `pos_saas` -> `npm run prisma:migrate` -> `npm run seed` -> `npm run dev` (port 3000). Di produksi gunakan `prisma migrate deploy` (bukan `migrate dev`).

Titik masuk: tidak ada server kustom. Route handler `src/app/api/**/route.ts`; halaman `src/app/page.tsx` (root), `src/app/admin/**` (Admin Panel web). Singleton Prisma di `src/lib/prisma.ts`.

### Variabel lingkungan (dari `.env.example`; nilai contoh saja)
| Var | Fungsi | Catatan |
|---|---|---|
| `DATABASE_URL` | koneksi MySQL | contoh `mysql://root:password@localhost:3306/pos_saas` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | secret JWT | **ada fallback hard-coded** `dev-access-secret` / `dev-refresh-secret` di `lib/auth.ts` bila env kosong |
| `JWT_ACCESS_EXPIRES` (15m), `JWT_REFRESH_EXPIRES` (30d) | masa berlaku token | |
| `UPLOAD_DIR` | folder upload gambar produk | default `<cwd>/storage/uploads` (di-gitignore) |
| `SEED_SUPER_ADMIN_EMAIL/PASSWORD` | akun super admin awal | dipakai `prisma/seed.ts`; seed mencetak password ke console |
| `WHATSAPP_API_URL`, `WHATSAPP_DEVICE_ID`, `WHATSAPP_AUTH_USERNAME`, `WHATSAPP_AUTH_PASSWORD`, `WHATSAPP_ENABLED` | gateway WA | Device ID & enabled bisa dioverride lewat tabel `platform_settings` |

Catatan lingkungan (skill `dt-laragon-env-audit` ditujukan PHP/Laravel/Flutter; relevan sebagian): ini proyek Node, bukan PHP, jadi cek versi PHP/ekstensi tidak berlaku. Yang relevan: butuh Node (versi tidak dipatok, tidak ada `engines`/`.nvmrc`), MySQL dari Laragon, dan **folder berada di `C:\laragon\www\`** sehingga vhost auto Laragon bisa membuat `pos-backend.test` (tidak berpengaruh ke Next.js yang jalan di port 3000).

## 2. Struktur folder

```
pos-backend/
  prisma/            schema.prisma, seed.ts, migrations/ (4 migrasi + migration_lock mysql)
  public/            download/app-release.apk (68 MB, TERLACAK git), uploads/products/tenant-test-123/*.png (3 file uji, terlacak git)
  src/
    app/
      layout.tsx, page.tsx            shell root + halaman awal
      admin/                          Admin Panel web (client component, fetch via adminFetch)
        login, dashboard (approve/reject tenant), subscriptions (konfirmasi bayar), settings (WhatsApp), admin.css, layout.tsx, page.tsx (redirect)
      api/                            58 route handler (lihat bagian 4)
    components/admin/                 Sidebar, StatusStamp, Toast
    lib/                              logika bersama (lihat bawah)
  docs/analysis/                      (dibuat oleh analis)
  README.md                           masih deskripsi "Fase 1" (kadaluarsa)
```

Peran `src/lib/`:
| File | Peran |
|---|---|
| `prisma.ts` | singleton PrismaClient |
| `auth.ts` | hash/compare password, sign/verify JWT, `getTenantUserFromRequest`, `getAdminFromRequest`, `requireRole`, `AuthError` |
| `inventory.ts` | `adjustStock()` (ubah Stock + catat StockMovement dalam transaksi), `StockInsufficientError` |
| `sales.ts` | `calculateSaleTotals()`, `generateInvoiceNumber()` (format `INV-YYYYMMDD-0001`) |
| `accounting.ts` | `ACCOUNT_CODES`, `createJournalEntry` (validasi debit=kredit), `postSaleJournal`, `postPurchaseJournal`, `postPurchasePaymentJournal`, `postExpenseJournal`, `reverseJournalForReference` |
| `subscription.ts` | trial 30 hari, batas FREE 10 transaksi/hari, `getSubscriptionAccessStatus` |
| `menu-permissions.ts` | `MENU_KEYS` (kasir, inventori, laporan, pengaturan), resolve akses menu per role |
| `product-units.ts` | satuan tambahan produk (zod `unitSchema`, cek barcode, sync nonaktifkan bukan hapus) |
| `product-prices.ts` | harga per level (sync replace penuh) |
| `uploads.ts` | `UPLOAD_ROOT`, `safeUploadPath` (anti path traversal) |
| `whatsapp.ts` | kirim WA, template pesan approve/reject, setting di `platform_settings` |
| `admin-client.ts` | helper fetch + simpan token admin di `localStorage` (sisi browser) |

## 3. Skema database (Prisma, MySQL, 25 model)

Semua id `String @id @default(uuid())`; kolom di-map snake_case. Uang `Decimal(14,2)`. Isolasi multi-tenant lewat kolom `tenantId` (di-filter manual di tiap query, **tidak ada row-level guard terpusat**).

**Enum:** PlanType(FREE, SUBSCRIBE); TenantStatus(PENDING, APPROVED, REJECTED, SUSPENDED); BillingCycle(MONTHLY, YEARLY); SubscriptionStatus(TRIAL, ACTIVE, PENDING_PAYMENT, EXPIRED, CANCELLED); PaymentStatus(UNPAID, PAID); AdminRole(SUPER_ADMIN, ADMIN_SUPPORT); UserRole(OWNER, MANAGER, KASIR, GUDANG, AKUNTAN); StockMovementType(IN, OUT, ADJUSTMENT, TRANSFER); PurchaseOrderStatus(DRAFT, RECEIVED, CANCELLED); PurchasePaymentMethod(CASH, CREDIT, TRANSFER); PurchasePaymentStatus(UNPAID, PARTIAL, PAID); DiscountType(PERCENT, NOMINAL); SaleStatus(PAID, PARTIAL, CANCELLED, REFUNDED); PaymentMethod(CASH, DEBIT, CREDIT, QRIS, TRANSFER, EWALLET); AccountType(ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE).

| Kelompok | Model (tabel) | Atribut/relasi kunci |
|---|---|---|
| Tenant & langganan | `Tenant` (tenants) | email unik global; planType, status, approvedBy/At, rejectedReason; induk dari hampir semua data |
| | `Subscription` (subscriptions) | tenantId; price, billingCycle, start/endDate (`@db.Date`), status, paymentStatus, paymentNote, paymentRequestedAt, confirmedBy/At. Renewal meng-update baris yang sama (1 baris/tenant) |
| Platform | `AdminUser` (admin_users) | email unik, role SUPER_ADMIN/ADMIN_SUPPORT |
| | `PlatformSetting` (platform_settings) | key unik, value Text (whatsapp_device_id, whatsapp_enabled) |
| User | `User` (users) | unik `(tenantId,email)`; role default KASIR; isActive; relasi `Sale[]` (CashierSales) |
| | `RoleMenuPermission` | unik `(tenantId,role,menuKey)`; model opt-out (tak ada baris = boleh) |
| Katalog | `Category`, `Product` | Product: sku, barcode (tidak ada unique DB), unit dasar, costPrice (per satuan dasar), sellPrice, minStock, imageUrl, isActive |
| | `ProductUnit` | satuan tambahan: conversionQty, sellPrice, barcode, isActive (tanpa relasi ke Tenant di Prisma, hanya kolom tenantId) |
| | `PriceLevel`, `ProductPrice` | level harga tambahan; ProductPrice unik `(productId,priceLevelId)`, cascade delete |
| Stok | `Warehouse`, `Stock` (unik productId+warehouseId), `StockMovement` | movement: type, qty positif, referenceType (SALE/PURCHASE/MANUAL/TRANSFER), referenceId, createdBy |
| Pembelian | `Supplier`, `PurchaseOrder` (unik tenantId+poNumber), `PurchaseOrderItem`, `PurchasePayment` | item menyimpan snapshot unitLabel & conversionQty |
| Penjualan | `Customer`, `Sale` (unik tenantId+invoiceNo), `SaleItem`, `SalePayment` | Sale: subtotal, diskon (type/value/amount), taxPercent default 11, taxAmount, grandTotal, paidTotal, changeAmount, status |
| Akunting | `ChartOfAccount` (unik tenantId+code), `JournalEntry`, `JournalLine`, `Expense` | JournalEntry tanpa relasi Prisma ke Tenant; referenceType: SALE, SALE_CANCEL, PURCHASE, PURCHASE_PAYMENT, EXPENSE, EXPENSE_CANCEL |

Migrasi: `20260719012743_init`, `20260720032555_init`, `20260721071245_init`, `20260901095444_add_role_menu_permissions` (tiga migrasi bernama "init" berurutan, hasil `prisma:migrate` dengan nama tetap).

Catatan skema:
- Tidak ada FK/relasi Prisma untuk `Product.tenant` pada ProductUnit/Stock/StockMovement/PurchaseOrder/JournalEntry (hanya kolom `tenantId` string) - integritas tenant bergantung kode.
- Tidak ada index selain PK/unique (mis. `sales(tenantId, createdAt)`, `stock_movements(tenantId, productId)`) - risiko performa saat data besar.
- Tidak ada model/field untuk: refund (status REFUNDED ada tapi tidak ada endpoint), transfer stok (enum TRANSFER ada, tidak dipakai), PO CANCELLED (tidak ada endpoint), billing YEARLY.
- Satuan tambahan: stok & costPrice selalu satuan dasar; `qty` pada SaleItem/PO item adalah qty satuan terpilih (kali `conversionQty` saat mengubah stok).

## 4. Daftar endpoint API

Konvensi umum: respons sukses `{ message?, data }`; error `{ message, errors? }`; paginasi `{ data, pagination:{page,pageSize,total,totalPages} }` (pageSize maks 100). Auth tenant = header `Authorization: Bearer <accessToken>` (JWT `type=tenant_user`); "Auth admin" = JWT `type=admin`. "Login saja" = semua role tenant. Semua query tenant di-scope `tenantId` dari token.

### 4.1 Auth & registrasi (publik / tenant)
| Method | Path | Fungsi | Otorisasi | Validasi / request -> response |
|---|---|---|---|---|
| POST | `/api/auth/register-tenant` | daftar tenant baru (PENDING) + user OWNER tak aktif; bila SUBSCRIBE buat trial 30 hari | publik | zod: businessName>=3, ownerName>=3, email, phone?, address?, password>=6, planType(FREE/SUBSCRIBE). 201 `{message, tenant{id,businessName,status,planType}}`; 409 email ada |
| POST | `/api/auth/login` | login user tenant | publik | `{email,password}`. Tolak 403 bila tenant PENDING/REJECTED/SUSPENDED (+`tenantStatus`), user nonaktif, atau langganan habis (`SUBSCRIPTION_EXPIRED`). 200 `{accessToken, refreshToken, user{id,name,email,role,menuAccess[],tenant{id,businessName,planType}}}` |
| POST | `/api/auth/refresh` | tukar refresh token jadi access token baru | publik (refreshToken) | `{refreshToken}`; re-validasi tenant APPROVED & langganan. 200 `{accessToken}`; 401 bila tidak valid |

### 4.2 Platform admin (JWT admin)
| Method | Path | Fungsi | Otorisasi | Catatan |
|---|---|---|---|---|
| POST | `/api/admin/auth/login` | login admin | publik | `{email,password}` -> `{accessToken, refreshToken, admin}` |
| GET | `/api/admin/tenants` | daftar tenant (+subscriptions) | admin (semua role) | query `status`, `search` (tanpa paginasi) |
| POST | `/api/admin/tenants/[id]/approve` | approve tenant: aktifkan OWNER, buat gudang "Toko Pusat" + 10 akun COA default, kirim WA | admin | 409 bila sudah APPROVED |
| POST | `/api/admin/tenants/[id]/reject` | tolak tenant | admin | `{reason>=3}`; kirim WA |
| GET | `/api/admin/subscriptions` | daftar langganan + `computedStatus`, `daysRemaining` | admin | query `status` |
| POST | `/api/admin/subscriptions/[id]/confirm-payment` | konfirmasi bayar & perpanjang | admin | `{price?, extendDays=30}`; kirim WA |
| GET | `/api/admin/settings/whatsapp` | baca setting WA | admin | |
| PUT | `/api/admin/settings/whatsapp` | ubah deviceId/enabled, opsional kirim pesan uji `testPhone` | **SUPER_ADMIN saja** | |
| POST | `/api/admin/send-whatsapp` | kirim WA bebas | **TANPA AUTH** (lihat risiko) | `{phone,message}`; kredensial & device ID hard-coded; `GET` sama juga publik (health) |

### 4.3 Langganan tenant
| Method | Path | Fungsi | Otorisasi |
|---|---|---|---|
| GET | `/api/tenant/subscription` | status paket (FREE: kuota harian; SUBSCRIBE: status/endDate/daysRemaining) | login |
| POST | `/api/tenant/subscription/request-payment` | ajukan perpanjangan -> status PENDING_PAYMENT (`{note?}`) | OWNER; 409 bila bukan SUBSCRIBE atau sudah pending |
| POST | `/api/tenant/subscription/upgrade` | FREE -> SUBSCRIBE + trial 30 hari, tanpa approval admin | OWNER |

### 4.4 Pengguna & hak akses menu
| Method | Path | Fungsi | Otorisasi | Validasi |
|---|---|---|---|---|
| GET | `/api/users` | daftar user tenant (tanpa password) | OWNER, MANAGER | |
| POST | `/api/users` | tambah user | OWNER | name>=2, email, phone?, password>=6, role enum; 409 email dobel (per tenant) |
| PUT | `/api/users/[id]` | ubah name/phone/role/isActive/password | OWNER | tidak boleh menurunkan/menonaktifkan OWNER aktif terakhir (409) |
| DELETE | `/api/users/[id]` | nonaktifkan (soft) | OWNER | guard OWNER terakhir |
| GET | `/api/menu-permissions` | matriks role x menu | OWNER | |
| PUT | `/api/menu-permissions` | simpan override `{updates:[{role,menuKey,canAccess}]}` | OWNER | OWNER & menu `pengaturan` terkunci (diabaikan diam-diam) |

### 4.5 Master data
| Method | Path | Fungsi | Otorisasi | Catatan |
|---|---|---|---|---|
| GET/POST | `/api/categories` | list (+jumlah produk) / buat `{name>=2}` | GET login; POST OWNER, MANAGER, GUDANG | |
| PUT/DELETE | `/api/categories/[id]` | ubah / hapus | PUT OWNER,MANAGER,GUDANG; DELETE OWNER,MANAGER | DELETE 409 bila dipakai produk |
| GET/POST | `/api/customers` | list `?search` / buat `{name>=2,phone?,email?}` | login (semua role) | |
| PUT/DELETE | `/api/customers/[id]` | ubah / hapus | login (semua role, termasuk GUDANG/AKUNTAN) | DELETE 409 bila punya transaksi |
| GET/POST | `/api/suppliers` | list / buat `{name>=2,phone?,address?}` | GET login; POST OWNER,MANAGER,GUDANG | |
| PUT/DELETE | `/api/suppliers/[id]` | ubah / hapus | PUT OWNER,MANAGER,GUDANG; DELETE OWNER,MANAGER | DELETE 409 bila punya PO |
| GET/POST | `/api/warehouses` | list / buat `{name>=2}` | GET login; POST OWNER,MANAGER | |
| PUT/DELETE | `/api/warehouses/[id]` | ubah / hapus | PUT OWNER,MANAGER; DELETE OWNER | DELETE 409 bila ada stok > 0 |
| GET/POST | `/api/price-levels` | list (+jumlah harga) / buat `{name>=2}` | GET login; POST OWNER,MANAGER | |
| PUT/DELETE | `/api/price-levels/[id]` | ubah / hapus (cascade ke `product_prices`) | OWNER,MANAGER | |

### 4.6 Produk, upload, stok
| Method | Path | Fungsi | Otorisasi | Request/response ringkas |
|---|---|---|---|---|
| GET | `/api/products` | list produk + kategori, stok per gudang, satuan aktif, harga level, `totalStock` | login | query `search` (name/sku/barcode), `categoryId`, `lowStock=true`, `includeInactive=true`, `page`, `pageSize`(20, maks 100). **Catatan:** filter `lowStock` diterapkan SETELAH paginasi (total/pagination tidak mencerminkan filter) |
| POST | `/api/products` | buat produk (+units, prices, initialStock) dalam 1 transaksi | OWNER,MANAGER,GUDANG | zod: name>=2, unit="pcs", costPrice, sellPrice, minStock, categoryId?, sku?, barcode?, imageUrl?, `initialStock{warehouseId,quantity}`, `units[]`, `prices[]`. 409 barcode dobel; 400 level harga invalid |
| GET | `/api/products/scan?code=` | cari produk via barcode dasar / barcode satuan -> `{product, matchedUnitId}` | login | 404 bila tak ada |
| GET | `/api/products/[id]` | detail | login | |
| PUT | `/api/products/[id]` | ubah; `units`/`prices` bila dikirim disinkronkan penuh, bila tidak dikirim tidak disentuh; `imageUrl:""` -> null | OWNER,MANAGER,GUDANG | |
| DELETE | `/api/products/[id]` | soft delete (`isActive=false`) | OWNER,MANAGER | |
| POST | `/api/upload` | upload gambar produk (multipart `file`; JPG/PNG/WEBP, maks 5 MB) -> `{data:{url:"/api/uploads/products/<tenantId>/<file>"}}` | OWNER,MANAGER,GUDANG | validasi hanya MIME dari klien |
| GET | `/api/uploads/[...path]` | sajikan file upload | **publik (sengaja)** | `safeUploadPath` anti traversal + whitelist ekstensi; cache 1 tahun |
| GET | `/api/stocks` | stok per produk-gudang + `isLowStock` | login | query `warehouseId`, `lowStock` (tanpa paginasi) |
| GET | `/api/stock-movements` | kartu stok | login | query `productId`, `warehouseId`, `page`, `pageSize`(30) |
| POST | `/api/stock-movements` | koreksi stok manual | OWNER,MANAGER,GUDANG | `{productId, warehouseId, direction:IN|OUT, qty>0, note>=3}` -> `{newQuantity}`; 400 bila stok kurang |

### 4.7 Penjualan (POS)
| Method | Path | Fungsi | Otorisasi | Request/response ringkas |
|---|---|---|---|---|
| GET | `/api/sales` | riwayat | login (semua role) | query `status`, `warehouseId`, `cashierId`, `dateFrom`, `dateTo` (YYYY-MM-DD), `page`, `pageSize` |
| POST | `/api/sales` | buat transaksi: cek batas FREE (10/hari), hitung total, buat Sale+Item+Payment, kurangi stok (qty x conversionQty), jurnal otomatis | OWNER,MANAGER,KASIR | `{warehouseId, customerId?, items[{productId, productUnitId?, qty, unitPrice?, discountAmount=0}], discountType=NOMINAL, discountValue=0, taxPercent=11, payments[{method,amount,referenceNo?}], note?}` -> 201 `{data: sale lengkap + tenant info untuk struk}`; 403 `FREE_LIMIT_REACHED`; 400 stok kurang. Status PAID bila paidTotal>=grandTotal, selain itu PARTIAL (piutang) |
| GET | `/api/sales/[id]` | detail untuk struk | login | |
| POST | `/api/sales/[id]/cancel` | batalkan: kembalikan stok, status CANCELLED, jurnal balik | OWNER,MANAGER | `{reason>=3}`; 409 bila sudah batal |
| POST | `/api/sales/[id]/payments` | tambah pelunasan piutang | OWNER,MANAGER,KASIR | `{method, amount>0, referenceNo?}`; hanya status PARTIAL (409 lainnya) |

### 4.8 Pembelian (Purchase Order)
| Method | Path | Fungsi | Otorisasi | Catatan |
|---|---|---|---|---|
| GET | `/api/purchase-orders` | list (+supplier, gudang, item) | login | query `status`; **tanpa paginasi** |
| POST | `/api/purchase-orders` | buat PO DRAFT | OWNER,MANAGER,GUDANG | `{supplierId?, warehouseId, paymentMethod=CASH|CREDIT|TRANSFER, items[{productId, productUnitId?, qty, unitCost}]}`; `poNumber = PO-<Date.now()>` |
| GET | `/api/purchase-orders/[id]` | detail (+payments, info tenant) | login | |
| POST | `/api/purchase-orders/[id]/receive` | terima barang: stok bertambah (qty x conversionQty), `costPrice` produk = harga beli terakhir / konversi, CASH/TRANSFER langsung PAID, jurnal | OWNER,MANAGER,GUDANG | 409 bila sudah RECEIVED/CANCELLED |
| GET | `/api/purchase-orders/[id]/payments` | riwayat cicilan hutang | login | |
| POST | `/api/purchase-orders/[id]/payments` | bayar hutang PO tempo | OWNER,MANAGER,AKUNTAN | `{method:CASH|TRANSFER, amount>0, referenceNo?}`; hanya PO RECEIVED + CREDIT + belum lunas; tak boleh melebihi sisa |

### 4.9 Akunting & laporan
| Method | Path | Fungsi | Otorisasi |
|---|---|---|---|
| GET/POST | `/api/accounting/chart-of-accounts` | list / buat akun `{code,name,type}` | GET login; POST OWNER,AKUNTAN (409 kode dobel) |
| PUT/DELETE | `/api/accounting/chart-of-accounts/[id]` | ubah nama / hapus | OWNER,AKUNTAN; DELETE ditolak untuk 10 kode default dan akun yang punya jurnal |
| GET | `/api/accounting/journal` | jurnal umum (+lines, akun) | OWNER,MANAGER,AKUNTAN; query `dateFrom,dateTo,referenceType,page,pageSize` |
| GET | `/api/accounting/ledger` | buku besar + saldo berjalan | OWNER,MANAGER,AKUNTAN; `accountId` wajib, `dateFrom,dateTo` |
| GET/POST | `/api/expenses` | list (+total) `?dateFrom&dateTo&category` / catat beban `{category>=2, amount>0, description?, expenseDate YYYY-MM-DD}` + jurnal (Beban Operasional / Kas) | GET login (semua role); POST OWNER,MANAGER,AKUNTAN |
| DELETE | `/api/expenses/[id]` | hapus beban + jurnal balik (tidak ada PUT) | OWNER,MANAGER,AKUNTAN |
| GET | `/api/reports/sales-summary` | ringkasan penjualan: transaksi, item, bruto, diskon, pajak, neto, piutang, per metode bayar, top 5 produk | login (semua role); default hari ini |
| GET | `/api/reports/purchases-summary` | ringkasan pembelian + hutang usaha berjalan | OWNER,MANAGER,GUDANG,AKUNTAN |
| GET | `/api/reports/profit-loss` | laba rugi dari jurnal (REVENUE/EXPENSE, HPP kode 5000) + info pembelian & hutang | OWNER,MANAGER,AKUNTAN; default awal bulan s.d. sekarang |

### 4.10 Lainnya
| Method | Path | Fungsi | Otorisasi |
|---|---|---|---|
| GET | `/api/version` | info versi app mobile, URL APK (nilai hard-coded: version 1.0.0, build 1, forceUpdate false) | publik |

Total: 58 file `route.ts`, sekitar 80 kombinasi method+path.

## 5. Autentikasi, otorisasi, error, pola kode

- **Token:** access (default 15m) + refresh (30d), HS256 lewat `jsonwebtoken`; payload tenant `{type:"tenant_user", userId, tenantId, role}` atau admin `{type:"admin", adminId, role}`. Access dan refresh dibedakan hanya oleh secret berbeda. Tidak ada revoke/blacklist/rotation refresh token.
- **Pola otorisasi per handler (tanpa middleware):** setiap route memanggil `getTenantUserFromRequest(req)` lalu `requireRole(user, [...])`; `getAdminFromRequest` untuk admin. Tidak ada `middleware.ts`. Kalau developer lupa memanggil guard, endpoint terbuka (kasus nyata: `/api/admin/send-whatsapp`).
- **Role matriks ringkas:** OWNER akses penuh; MANAGER hampir penuh (kecuali kelola user/menu/upgrade/hapus gudang); KASIR: jual & pelunasan piutang; GUDANG: produk/kategori/supplier/stok/PO/upload; AKUNTAN: COA, jurnal, laporan, beban, bayar hutang PO. `menuAccess` (kasir/inventori/laporan/pengaturan) hanya dikembalikan saat login untuk mengatur tab di aplikasi Flutter; **tidak di-enforce di API** (hanya UI).
- **Pengecekan status akun hanya saat login/refresh:** setiap request API hanya memverifikasi JWT. Tenant yang di-SUSPEND, user yang dinonaktifkan, atau langganan yang habis tetap bisa memakai API sampai access token (15m) berakhir; refresh akan gagal untuk tenant/langganan, tetapi **refresh tidak mengecek `user.isActive`** sehingga user nonaktif tetap bisa memperpanjang sesi sampai 30 hari.
- **Konvensi error:** `AuthError(message, status)` dilempar dari helper dan ditangkap di tiap handler -> `{message}` + status. Validasi zod gagal -> 400 `{message:"Data tidak valid", errors}` (beberapa hanya `message`). Konflik -> 409, tak ditemukan -> 404, stok kurang -> 400 (`StockInsufficientError`), selain itu 500 `"Terjadi kesalahan pada server"` + `console.error`. Pesan error berbahasa Indonesia.
- **Pola arsitektur:** tipis-tebal campuran. Route handler menaruh validasi + query Prisma + transaksi langsung di file route; logika yang dipakai ulang diekstrak ke `src/lib/*` (fungsi, bukan class). Tidak ada layer service/repository formal. Transaksi `prisma.$transaction(tx => ...)` dipakai untuk operasi multi-tabel (penjualan, PO receive, produk, beban). Snapshot satuan (`unitLabel`, `conversionQty`) disimpan di item transaksi. Jurnal akunting otomatis double-entry diposting dalam transaksi yang sama dengan sumbernya. Efek samping WhatsApp bersifat fire-and-forget (`.catch(console.error)`).
- **Aturan bisnis penting:** PPN default 11% (bisa dioverride klien); FREE dibatasi 10 transaksi/hari (menghitung semua Sale hari itu, apapun statusnya); trial SUBSCRIBE 30 hari; login diblokir bila langganan habis namun data tetap aman; kembalian dikurangkan dari kas pada jurnal penjualan.

## 6. Modul dan file terkait (untuk menentukan area saat update)

| Modul | Route | Lib | Model Prisma |
|---|---|---|---|
| Auth & registrasi | `api/auth/*` | `auth.ts`, `menu-permissions.ts`, `subscription.ts` | Tenant, User, Subscription |
| Admin platform (web + API) | `api/admin/**`, `app/admin/**`, `components/admin/**` | `admin-client.ts`, `whatsapp.ts`, `auth.ts` | AdminUser, Tenant, Subscription, PlatformSetting |
| Langganan tenant | `api/tenant/subscription/*` | `subscription.ts` | Subscription, Tenant |
| User & hak menu | `api/users/*`, `api/menu-permissions` | `menu-permissions.ts`, `auth.ts` | User, RoleMenuPermission |
| Kategori | `api/categories/*` | - | Category |
| Produk (satuan, level harga, scan) | `api/products/*`, `api/price-levels/*` | `product-units.ts`, `product-prices.ts`, `inventory.ts` | Product, ProductUnit, PriceLevel, ProductPrice |
| Upload gambar | `api/upload`, `api/uploads/[...path]` | `uploads.ts` | (file system) |
| Stok & gudang | `api/stocks`, `api/stock-movements`, `api/warehouses/*` | `inventory.ts` | Warehouse, Stock, StockMovement |
| Pelanggan | `api/customers/*` | - | Customer |
| Penjualan | `api/sales/*` | `sales.ts`, `inventory.ts`, `accounting.ts`, `subscription.ts` | Sale, SaleItem, SalePayment |
| Pembelian & supplier | `api/purchase-orders/**`, `api/suppliers/*` | `inventory.ts`, `accounting.ts` | PurchaseOrder, PurchaseOrderItem, PurchasePayment, Supplier |
| Akunting & beban | `api/accounting/*`, `api/expenses/*` | `accounting.ts` | ChartOfAccount, JournalEntry, JournalLine, Expense |
| Laporan | `api/reports/*` | - | (baca Sale, PurchaseOrder, JournalLine) |
| Versi aplikasi mobile | `api/version`, `public/download/app-release.apk` | - | - |

Klien: aplikasi Flutter (repo terpisah `pos-mobile`, disebut di komentar `menu-permissions.ts`: `lib/features/dashboard/dashboard_screen.dart`). Perubahan kontrak API di sini berdampak ke sana; **tidak ada `docs/api-contract.md`**, jadi daftar di bagian 4 ini adalah satu-satunya dokumentasi kontrak.

## 7. Utang teknis, risiko, hal ganjil

### Keamanan (prioritas tinggi)
1. **`POST /api/admin/send-whatsapp` tanpa autentikasi** dan memuat kredensial gateway WA (Basic auth + Device ID) **hard-coded di kode sumber yang ter-commit**. Siapa pun di internet dapat mengirim WA lewat akun ini (penyalahgunaan/spam, biaya, reputasi nomor). Kredensial itu juga berbeda dari yang di `.env.example`. Saran: hapus/amankan route (atau pakai `sendWhatsappMessage` dari `lib/whatsapp.ts` + `getAdminFromRequest`), anggap kredensial itu bocor dan rotasi. Karena terlacak di git, kredensial ada di histori.
2. `.env.example` memuat kredensial WA yang tampak nyata (device ID, username/password), bukan placeholder. Perlakukan sebagai bocor; ganti ke placeholder.
3. **Fallback secret JWT** `dev-access-secret`/`dev-refresh-secret` bila env tidak diset: di produksi yang salah konfigurasi, token dapat dipalsukan. Sebaiknya gagal saat start bila kosong di `NODE_ENV=production`.
4. Tidak ada rate limiting / lockout di login, register-tenant, refresh. Pesan 401 sama untuk salah email/password (baik), tetapi brute force tidak dibatasi.
5. `POST /api/auth/login` memakai `findFirst({where:{email}})` padahal unik hanya `(tenantId,email)`: email yang sama di dua tenant akan login ke salah satu secara tak deterministik, dan password tenant lain bisa tak cocok. Perlu identifier tenant atau email unik global.
6. Status akun tidak dicek per request (lihat bagian 5): user nonaktif / tenant suspend tetap berjalan sampai token kadaluarsa; refresh tidak mengecek `isActive`.
7. Token admin disimpan di `localStorage` (`pos_admin_token`) - rentan XSS; `menu-permissions` tidak di-enforce di server.
8. Isolasi tenant tidak lengkap pada ID relasi dari klien (tidak divalidasi milik tenant): `categoryId` dan `initialStock.warehouseId` di POST/PUT produk, `customerId` di POST sales, `supplierId` di POST PO. Hasilnya referensi lintas tenant bisa tersimpan (IDOR tulis; baca balik lewat include bisa membocorkan nama). Perlu `findFirst({id, tenantId})` untuk tiap ID.
9. Upload: validasi hanya `file.type` dari klien (bukan magic bytes); file publik tanpa auth (disengaja, didokumentasikan). `.gitignore` mengabaikan `storage/` tetapi `public/uploads/products/tenant-test-123/*.png` ikut terlacak.
10. `taxPercent` dan `unitPrice` ditentukan klien pada `POST /api/sales` (server tidak memaksa harga/pajak dari master atau level harga); kasir termodifikasi dapat menjual dengan harga 0. Level harga (`ProductPrice`) hanya dipakai klien untuk mengisi `unitPrice`.

### Bug/logika yang terlihat
11. **Pembatalan penjualan mengembalikan stok dengan `item.qty` saja**, tidak dikali `conversionQty` (`sales/[id]/cancel`), padahal saat jual dikurangi `qty x conversionQty`. Pembatalan item per Dus (mis. 2 Dus = 48 botol) hanya mengembalikan 2. Stok jadi kurang.
12. **Pelunasan piutang (`sales/[id]/payments`) tidak memposting jurnal** (Kas/Bank vs Piutang Usaha). Saldo Piutang Usaha di buku besar tidak pernah berkurang; Kas tidak bertambah. Sebaliknya PO payment memposting jurnal. Hasil laporan laba-rugi tidak terpengaruh (hanya REVENUE/EXPENSE), tetapi neraca/buku besar tidak akurat. Pembatalan sale PARTIAL setelah pelunasan juga hanya membalik jurnal awal.
13. `PUT /api/products/[id]` tidak memeriksa duplikasi `barcode` produk (hanya POST dan barcode satuan yang dicek); DB tidak punya unique constraint untuk barcode/sku. Juga `lowStock` pada `/api/products` memfilter setelah paginasi.
14. Nomor invoice `INV-YYYYMMDD-NNNN` dihitung dari `count()` harian dan nomor PO dari `Date.now()`: dua request bersamaan dapat menabrak unique `(tenantId,invoiceNo)` -> 500; juga memakai zona waktu server (bukan WIB eksplisit) untuk "hari ini", batas FREE, dan laporan. Pembatalan tidak mengurangi count sehingga urutan tetap naik (baik), tetapi cek batas FREE (di luar transaksi) rentan balapan.
15. Sinkronisasi `syncProductUnits`: satuan yang tidak ada di payload dinonaktifkan (benar), tetapi `assertUnitBarcodesAvailable` hanya memeriksa barcode satuan aktif; satuan baru dan satuan lama dengan barcode sama dalam payload yang sama tidak dibandingkan satu sama lain.
16. Tarik tanggal: `new Date("YYYY-MM-DD")` = UTC midnight; filter `dateTo` pada `expenses`, `journal`, `ledger`, `profit-loss` memakai `lte` pada tanggal tanpa jam, sementara sales/purchases memakai `lt +1 hari`. Konvensi rentang tanggal tidak konsisten (profit-loss default `dateTo=now`, jurnal `@db.Date`).
17. Status `REFUNDED`, `CANCELLED` PO, enum `TRANSFER`, `BillingCycle.YEARLY`, `SUSPENDED` (tidak ada endpoint untuk men-suspend), `ADMIN_SUPPORT` vs `SUPER_ADMIN` (hanya pengaturan WA yang membedakan) ada di skema tetapi belum punya alur lengkap. Tidak ada endpoint untuk membatalkan PO DRAFT, mengubah PO, membuat admin baru, atau ganti password sendiri.
18. GET sales/customers/expenses/reports/sales-summary tidak dibatasi role (mis. GUDANG/AKUNTAN dapat melihat seluruh penjualan dan data pelanggan; semua role dapat melihat beban). Perlu dikonfirmasi apakah disengaja.
19. `/api/admin/tenants` dan list lain tidak berpaginasi (`purchase-orders`, `stocks`, `customers`, `suppliers`, `expenses`): risiko performa saat data besar. Tidak ada index tambahan.
20. `register-tenant`: `TODO` kirim email belum ada; `email` tenant unik global tetapi `users` unik per tenant. Registrasi tidak memverifikasi email/telepon.
21. `/api/version` hard-coded (version/build/notes); mengubah rilis harus edit kode dan commit APK.

### Utang teknis / kualitas
22. **Tidak ada test sama sekali** (tidak ada folder `tests`, tidak ada script `test`, tidak ada framework). Logika uang/akunting (`sales.ts`, `accounting.ts`, konversi satuan) paling butuh unit test.
23. Tidak ada CI, Dockerfile, atau konfigurasi deploy; `migrate dev` dipakai sebagai script utama (tidak cocok produksi); tiga migrasi bernama `init`.
24. `public/download/app-release.apk` (68,9 MB) terlacak di git: repo akan membengkak setiap rilis APK baru. Pertimbangkan hosting terpisah/Release.
25. Kode duplikasi: pola `try/catch AuthError` + `round2` disalin di puluhan route; tidak ada helper `handleError`/`withAuth`. Debug log dengan emoji dan data telepon di `send-whatsapp`.
26. `README.md` kadaluarsa (menyebut Fase 1 saja); tidak ada dokumentasi kontrak API; `lint` tanpa config eslint di repo (belum diverifikasi).
27. `tsconfig.tsbuildinfo` ada di folder (artefak build); periksa apakah di-gitignore (tidak tercantum di `.gitignore`).
28. Dependensi: tidak ada `engines` Node; `@prisma/client` memakai caret `^5.20` (lockfile ada).

### Ringkasan area paling berisiko untuk update berikutnya
`sales/*` + `lib/accounting.ts` + `lib/inventory.ts` (uang, stok, jurnal saling terkait; ada bug #11 dan #12), `auth/login` (#5, #6), `admin/send-whatsapp` (#1), dan validasi kepemilikan tenant pada ID relasi (#8). Disarankan menambahkan test sebelum mengubah modul-modul ini.
