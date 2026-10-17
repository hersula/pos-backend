# API Contract: Penjualan Konsinyasi (pos-backend)

Versi dokumen: 1.0 (2026-10-17). Cakupan dokumen ini: fitur **Konsinyasi** (tafsir A: barang milik kita dititipkan ke customer/outlet) dan perubahan pada endpoint lama yang menyentuhnya. Endpoint lain tidak berubah dan tidak didokumentasikan di sini.

## 0. Konvensi umum (mengikuti kode yang sudah ada)
- Base URL: `{host}/api`. Tanpa versi di path (API belum diversi).
- Auth: header `Authorization: Bearer <accessToken>` (JWT `tenant_user`). `tenantId` selalu dari JWT, tidak pernah dari body/query.
- Sukses: `{ "data": ... }` atau `{ "message": "...", "data": ... }`. Pembuatan = HTTP 201.
- Error: `{ "message": "teks Indonesia", "code"?: "KODE", "errors"?: { field: [pesan] } }`
  - 400 validasi / aturan bisnis, 401 token, 403 role, 404 tidak ditemukan **atau milik tenant lain** (tidak dibedakan), 409 status tidak sesuai, 500 `{message:"Terjadi kesalahan pada server"}` (tanpa stack trace).
- Pagination: query `page` (default 1), `pageSize` (default 20, maks 100). Respons menambah `"pagination": {"page","pageSize","total","totalPages"}`.
- Angka uang dikirim sebagai angka JSON atau string desimal dari Prisma Decimal (klien wajib parse keduanya, seperti endpoint lama). Tanggal ISO-8601.
- Role: `OWNER, MANAGER, KASIR, GUDANG, AKUNTAN`.

## 1. Konsep & aturan
- **Gudang konsinyasi**: `Warehouse.type = CONSIGNMENT`, terikat ke satu `customerId` (satu per customer per tenant, dibuat otomatis saat dokumen konsinyasi pertama untuk customer itu). Stok barang di outlet = stok gudang ini.
- Semua kuantitas stok dalam **satuan dasar** (`baseQty = qty x conversionQty`). `conversionQty` di-snapshot di item konsinyasi saat dibuat.
- Pendapatan diakui saat **settle-sale** (membuat `Sale` biasa dari gudang konsinyasi, memakai ulang logika harga/PPN/HPP/jurnal penjualan). Kirim dan retur **tidak** membuat jurnal (MVP; total persediaan tidak berubah).
- Invarian per item: `baseQtySold + baseQtyReturned <= baseQtySent`. Stok tidak pernah boleh negatif.
- Status: `DRAFT -> SENT -> PARTIALLY_SETTLED -> SETTLED`, atau `CANCELLED` (dari DRAFT, atau SENT yang belum ada terjual/retur).
  - Setelah settle/retur: semua item `sold+returned == sent` => `SETTLED`; sebagian => `PARTIALLY_SETTLED`.
  - Pembatalan Sale hasil settle (`POST /sales/{id}/cancel`) mengurangi `baseQtySold` dan status dihitung ulang (bisa kembali ke `SENT`).
- Semua ID dari klien (customerId, sourceWarehouseId, productId, productUnitId, consignmentItemId) divalidasi milik tenant yang sama; jika tidak => 404.
- Hak akses ringkas: **baca** = semua role tenant (termasuk KASIR). **Tulis** (create, update, send, settle-sale, return, cancel) = **OWNER, MANAGER**.

## 2. Objek

### ConsignmentOrder
```json
{
  "id": "uuid",
  "consignmentNo": "KNS-20261017-0001",
  "status": "DRAFT|SENT|PARTIALLY_SETTLED|SETTLED|CANCELLED",
  "customerId": "uuid",
  "customer": { "id": "uuid", "name": "Toko Maju", "phone": "0812..." },
  "sourceWarehouseId": "uuid",
  "sourceWarehouse": { "id": "uuid", "name": "Gudang Utama" },
  "consignWarehouseId": "uuid",
  "sentAt": "2026-10-17T03:00:00.000Z",
  "dueDate": "2026-11-17T00:00:00.000Z",
  "note": "string|null",
  "cancelReason": "string|null",
  "createdById": "uuid",
  "createdAt": "ISO", "updatedAt": "ISO",
  "summary": {
    "itemCount": 2,
    "totalValueSent": 480000,
    "totalValueSold": 300000,
    "totalValueReturned": 120000,
    "totalValueRemaining": 60000
  },
  "items": [ ConsignmentItem ],
  "settlements": [ ConsignmentSettlement ]
}
```
Pada **list** (`GET /consignments`) `items` dan `settlements` tidak disertakan (hanya header + `summary`). Nilai `summary` = baseQty x (`agreedUnitPrice / conversionQty`), dibulatkan 2 desimal.

### ConsignmentItem
```json
{
  "id": "uuid",
  "productId": "uuid",
  "product": { "id": "uuid", "name": "Air Mineral", "sku": "AM-01", "unit": "Botol" },
  "productUnitId": "uuid|null",
  "unitLabel": "Dus",
  "conversionQty": 24,
  "qtySent": 2,
  "baseQtySent": 48,
  "baseQtySold": 30,
  "baseQtyReturned": 18,
  "baseQtyRemaining": 0,
  "agreedUnitPrice": 96000
}
```
`unitLabel` = nama satuan terpilih (snapshot), `null` bila satuan dasar. `product.unit` = nama satuan dasar. `agreedUnitPrice` per satuan terpilih (per Dus).

### ConsignmentSettlement
```json
{
  "id": "uuid",
  "type": "SALE|RETURN",
  "saleId": "uuid|null",
  "invoiceNo": "INV-20261017-0003|null",
  "note": "string|null",
  "voidedAt": "ISO|null",
  "createdById": "uuid",
  "createdAt": "ISO",
  "lines": [ { "consignmentItemId": "uuid", "baseQty": 30 } ]
}
```
`voidedAt` terisi bila Sale terkait dibatalkan (baris itu tidak lagi dihitung terjual).

## 3. Endpoint

### 3.1 GET `/api/consignments`
Role: semua role tenant. Query: `status` (salah satu status), `customerId`, `page`, `pageSize`.
Respons 200: `{ "data": [ConsignmentOrder tanpa items/settlements], "pagination": {...} }`. Urut `createdAt` turun.

### 3.2 POST `/api/consignments`
Role: OWNER, MANAGER. Membuat dokumen **DRAFT** (belum memindahkan stok). Gudang konsinyasi customer dibuat otomatis bila belum ada.
```json
{
  "customerId": "uuid",
  "sourceWarehouseId": "uuid",
  "dueDate": "2026-11-17",
  "note": "opsional",
  "items": [ { "productId": "uuid", "productUnitId": "uuid|omit", "qty": 2, "agreedUnitPrice": 96000 } ]
}
```
Validasi: `items` 1-200 baris; `qty` integer 1-1.000.000; `agreedUnitPrice` >= 0 (opsional; bila dihilangkan dipakai harga jual satuan/produk saat ini); kombinasi `productId+productUnitId` tidak boleh ganda; `note` maks 1000 karakter; `sourceWarehouseId` harus bertipe `STORE`; `productUnitId` harus satuan aktif milik produk itu.
Respons 201: `{ "message": "Konsinyasi berhasil dibuat", "data": ConsignmentOrder }`.
Error: 400 validasi (`errors`) / gudang asal bukan STORE (`code: "INVALID_SOURCE_WAREHOUSE"`); 404 customer/gudang/produk/satuan tidak ditemukan; 403 role.

### 3.3 GET `/api/consignments/{id}`
Role: semua role tenant. Respons 200: `{ "data": ConsignmentOrder (lengkap) }`. 404 bila tidak ada / milik tenant lain.

### 3.4 PUT `/api/consignments/{id}`
Role: OWNER, MANAGER. Hanya status `DRAFT` (selain itu 409 `code: "INVALID_STATUS"`). Body sama dengan POST (semua field dikirim ulang; `items` diganti total). Respons 200: `{ "message", "data": ConsignmentOrder }`.

### 3.5 POST `/api/consignments/{id}/send`
Role: OWNER, MANAGER. Body kosong `{}`. Hanya `DRAFT`. Dalam satu transaksi: validasi stok gudang asal >= total `baseQtySent` per produk (jumlah semua baris produk yang sama), kurangi stok gudang asal dan tambah stok gudang konsinyasi (StockMovement `type: TRANSFER`, `referenceType: "CONSIGNMENT_SEND"`), status `SENT`, `sentAt = now`.
Respons 200: `{ "message": "Barang konsinyasi dikirim", "data": ConsignmentOrder }`.
Error: 409 `INVALID_STATUS`; 400 `INSUFFICIENT_STOCK` `{ "message": "Stok tidak mencukupi untuk ...", "code": "INSUFFICIENT_STOCK", "details": [ { "productId", "productName", "available": 10, "required": 48 } ] }`.

### 3.6 POST `/api/consignments/{id}/settle-sale`
Role: OWNER, MANAGER. Mencatat barang terjual di outlet. Hanya status `SENT` atau `PARTIALLY_SETTLED`. Membuat **Sale biasa** (`warehouseId` = gudang konsinyasi, `customerId` = outlet, `consignmentOrderId` terisi; invoice `INV-...`; stok gudang konsinyasi berkurang; jurnal penjualan dibuat).
```json
{
  "lines": [ { "consignmentItemId": "uuid", "qty": 30, "useBaseUnit": true, "unitPrice": 4000 } ],
  "discountType": "NOMINAL",
  "discountValue": 0,
  "taxPercent": 11,
  "payments": [ { "method": "TRANSFER", "amount": 100000, "referenceNo": "opsional" } ],
  "note": "opsional"
}
```
- `qty` integer > 0. Bila `useBaseUnit` false/hilang: `qty` dalam satuan item (mis. Dus), harga default `agreedUnitPrice`. Bila `true`: `qty` dalam satuan dasar (mis. Botol), harga default `agreedUnitPrice / conversionQty` dibulatkan 2 desimal.
- `unitPrice` opsional (override harga per satuan yang dipakai pada baris itu), >= 0.
- Satu `consignmentItemId` hanya boleh muncul satu kali per request. `lines` 1-200.
- `discountType` default `NOMINAL`, `discountValue` default 0, `taxPercent` default 11 (sama dengan `POST /sales`).
- `payments` **opsional**; dihilangkan/kosong = piutang penuh (Sale `status: PARTIAL`, `paidTotal: 0`). Metode: `CASH|DEBIT|CREDIT|QRIS|TRANSFER|EWALLET`. Pelunasan berikutnya lewat `POST /sales/{saleId}/payments`.
- Total `baseQty` baris tidak boleh melebihi `baseQtyRemaining` item.

Respons 201:
```json
{ "message": "Penjualan konsinyasi berhasil dicatat", "data": { "consignment": ConsignmentOrder, "sale": { ...objek Sale seperti POST /sales, plus "consignmentOrderId" } } }
```
Error: 409 `INVALID_STATUS`; 400 `EXCEEDS_REMAINING` (`details`: itemId, remaining, requested) / `INSUFFICIENT_STOCK`; 404 item bukan milik dokumen ini; 403 `FREE_LIMIT_REACHED` (tenant paket FREE, kuota 10 transaksi/hari, sama dengan `POST /sales`).

### 3.7 POST `/api/consignments/{id}/return`
Role: OWNER, MANAGER. Retur sisa barang dari outlet ke gudang asal. Status `SENT` atau `PARTIALLY_SETTLED`.
```json
{ "lines": [ { "consignmentItemId": "uuid", "qty": 18, "useBaseUnit": true } ], "note": "opsional" }
```
`qty` dan `useBaseUnit` bermakna sama seperti settle-sale. Stok: gudang konsinyasi dikurangi, gudang asal ditambah sebesar `baseQty` (StockMovement `TRANSFER`, `referenceType: "CONSIGNMENT_RETURN"`). Tidak ada jurnal.
Respons 200: `{ "message": "Retur konsinyasi dicatat", "data": ConsignmentOrder }`. Error: 409 `INVALID_STATUS`; 400 `EXCEEDS_REMAINING`; 404.

### 3.8 POST `/api/consignments/{id}/cancel`
Role: OWNER, MANAGER. Body `{ "reason": "min 3 karakter" }`. Boleh dari `DRAFT`, atau `SENT` bila belum ada barang terjual maupun diretur (stok dikembalikan penuh ke gudang asal, `referenceType: "CONSIGNMENT_CANCEL"`). Selain itu 409 `INVALID_STATUS` (gunakan retur / batalkan Sale-nya dulu).
Respons 200: `{ "message": "Konsinyasi dibatalkan", "data": ConsignmentOrder }`.

### 3.9 GET `/api/consignments/outlet-stock`
Role: semua role tenant. Sisa stok fisik di gudang konsinyasi (apa yang sekarang ada di outlet). Query: `customerId` (opsional; tanpa ini semua outlet).
Respons 200:
```json
{ "data": [
  { "customerId": "uuid", "customerName": "Toko Maju", "warehouseId": "uuid", "warehouseName": "Konsinyasi - Toko Maju",
    "products": [ { "productId": "uuid", "name": "Air Mineral", "sku": "AM-01", "unit": "Botol", "quantity": 6 } ] }
] }
```
Hanya produk dengan `quantity > 0`; outlet tanpa stok tidak disertakan. `quantity` dalam satuan dasar.

## 4. Perubahan pada endpoint yang sudah ada

### 4.1 GET `/api/warehouses`
Query baru `type`: `STORE` (**default bila tidak diisi**), `CONSIGNMENT`, atau `ALL`. Nilai lain => 400. Setiap objek gudang kini memuat `type` (`STORE|CONSIGNMENT`) dan `customerId` (`null` untuk STORE). Tujuan: kasir/checkout tidak melihat gudang outlet.
`POST /warehouses` selalu membuat `STORE`. `PUT` dan `DELETE /warehouses/{id}` pada gudang `CONSIGNMENT` => 409 (dikelola otomatis).

### 4.2 POST `/api/sales`
- `warehouseId` bertipe `CONSIGNMENT` ditolak: 400 `code: "CONSIGNMENT_WAREHOUSE"` (penjualan outlet hanya lewat `settle-sale`).
- `customerId` kini divalidasi milik tenant (sebelumnya tidak): tidak ditemukan => 404 "Pelanggan tidak ditemukan".

### 4.3 POST `/api/sales/{id}/cancel` (perbaikan bug)
Stok yang dikembalikan kini `qty x conversionQty` (sebelumnya hanya `qty`). Jurnal pelunasan piutang (`SALE_PAYMENT`) ikut dibalik. Bila Sale berasal dari konsinyasi, `baseQtySold` item dikurangi, settlement ditandai `voidedAt`, stok kembali ke gudang konsinyasi, status konsinyasi dihitung ulang.

### 4.4 POST `/api/sales/{id}/payments` (perbaikan bug)
Kini membuat jurnal `referenceType: "SALE_PAYMENT"`: Debit Kas (CASH) atau Bank (metode lain), Kredit Piutang Usaha, sebesar `min(amount, sisa piutang)` (kelebihan = kembalian, tidak dijurnal). Pemeriksaan status `PARTIAL` dilakukan ulang di dalam transaksi.

## 5. Skema database (perubahan additive)
| Tabel | Perubahan |
|---|---|
| `warehouses` | + `type ENUM('STORE','CONSIGNMENT') NOT NULL DEFAULT 'STORE'`, + `customer_id VARCHAR NULL` (FK `customers.id`), unique `(tenant_id, customer_id, type)`, index `(tenant_id, type)` |
| `sales` | + `consignment_order_id VARCHAR NULL` (FK), index |
| `consignment_orders` | id, tenant_id, consignment_no (unik per tenant), customer_id, source_warehouse_id, consign_warehouse_id, status ENUM(DRAFT,SENT,PARTIALLY_SETTLED,SETTLED,CANCELLED), sent_at, due_date, note, cancel_reason, created_by_id, created_at, updated_at; index (tenant_id,status), (tenant_id,customer_id) |
| `consignment_items` | id, consignment_order_id, product_id, product_unit_id NULL, unit_label NULL, conversion_qty_snapshot, qty_sent, base_qty_sent, base_qty_sold, base_qty_returned, agreed_unit_price DECIMAL(14,2) |
| `consignment_settlements` | id, tenant_id, consignment_order_id, type ENUM(SALE,RETURN), sale_id NULL unik, note, voided_at NULL, created_by_id, created_at, lines JSON |
| `stock_movements` | tidak berubah. Dipakai `type = TRANSFER` + `reference_type` `CONSIGNMENT_SEND/RETURN/CANCEL` (kolom string, bukan enum) |

Migrasi: `prisma/migrations/20261017000000_add_consignment/migration.sql` (hanya CREATE TABLE / ADD COLUMN; tidak ada drop/rename). Semua data gudang lama otomatis `STORE`.
