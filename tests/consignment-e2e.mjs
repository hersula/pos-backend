// E2E konsinyasi terhadap server nyata + DB uji TERPISAH (qc_consign_test).
// Jalankan: DATABASE_URL=mysql://root:@127.0.0.1:3306/qc_consign_test JWT_ACCESS_SECRET=qc-secret BASE=http://127.0.0.1:3999 node tests/consignment-e2e.mjs
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const SECRET = process.env.JWT_ACCESS_SECRET ?? "qc-secret";
if (!/qc_consign_test/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Menolak jalan: DATABASE_URL bukan DB uji qc_consign_test");
  process.exit(2);
}
const db = new PrismaClient();
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("PASS", name); }
  else { fail++; failures.push(name); console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ""); }
}
const tokFor = (userId, tenantId, role) => jwt.sign({ type: "tenant_user", userId, tenantId, role }, SECRET, { expiresIn: "1h" });
async function mkUser(tenantId, role, tag) {
  const u = await db.user.create({ data: { tenantId, name: role + tag, email: `${role.toLowerCase()}-${tag}-${Date.now()}@qc.test`, password: "x", role, isActive: true } });
  return tokFor(u.id, tenantId, role);
}
async function api(method, path, token, body, raw) {
  const r = await fetch(BASE + "/api" + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const stock = async (pid, wid) => (await db.stock.findUnique({ where: { productId_warehouseId: { productId: pid, warehouseId: wid } } }))?.quantity ?? 0;
async function acctSum(tenantId, code) {
  const acc = await db.chartOfAccount.findFirst({ where: { tenantId, code } });
  const lines = await db.journalLine.findMany({ where: { accountId: acc.id } });
  return lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
}

async function mkTenant(tag, plan = "SUBSCRIBE") {
  const t = await db.tenant.create({ data: { businessName: "QC " + tag, ownerName: "Owner " + tag, email: `${tag}-${Date.now()}@qc.test`, planType: plan, status: "APPROVED" } });
  const codes = [["1000", "Kas", "ASSET"], ["1100", "Bank", "ASSET"], ["1200", "Piutang", "ASSET"], ["1300", "Persediaan", "ASSET"], ["2000", "Hutang", "LIABILITY"], ["2100", "PPN", "LIABILITY"], ["3000", "Modal", "EQUITY"], ["4000", "Pendapatan", "REVENUE"], ["5000", "HPP", "EXPENSE"], ["6000", "Beban", "EXPENSE"]];
  for (const [code, name, type] of codes) await db.chartOfAccount.create({ data: { tenantId: t.id, code, name, type } });
  const wh = await db.warehouse.create({ data: { tenantId: t.id, name: "Gudang " + tag } });
  const cust = await db.customer.create({ data: { tenantId: t.id, name: "Toko " + tag } });
  const prod = await db.product.create({ data: { tenantId: t.id, name: "Air " + tag, sku: "AM-" + tag, unit: "Botol", costPrice: 2000, sellPrice: 4000 } });
  const dus = await db.productUnit.create({ data: { tenantId: t.id, productId: prod.id, name: "Dus", conversionQty: 24, sellPrice: 96000 } });
  await db.stock.create({ data: { tenantId: t.id, productId: prod.id, warehouseId: wh.id, quantity: 100 } });
  return { t, wh, cust, prod, dus, owner: await mkUser(t.id, "OWNER", tag), mgr: await mkUser(t.id, "MANAGER", tag), kasir: await mkUser(t.id, "KASIR", tag), gudang: await mkUser(t.id, "GUDANG", tag), akun: await mkUser(t.id, "AKUNTAN", tag) };
}

const A = await mkTenant("A"), B = await mkTenant("B");
const mkBody = (qty = 2, extra = {}) => ({ customerId: A.cust.id, sourceWarehouseId: A.wh.id, items: [{ productId: A.prod.id, productUnitId: A.dus.id, qty, agreedUnitPrice: 96000 }], ...extra });

// ---- Auth/role
ok("401 tanpa token", (await api("GET", "/consignments")).s === 401);
for (const r of ["kasir", "gudang", "akun"]) ok(`403 POST consignments role ${r}`, (await api("POST", "/consignments", A[r], mkBody())).s === 403);
for (const r of ["kasir", "gudang", "akun", "mgr", "owner"]) ok(`200 GET consignments role ${r}`, (await api("GET", "/consignments", A[r])).s === 200);

// ---- Warehouses
const w = await api("GET", "/warehouses", A.kasir);
ok("warehouses default STORE ada type", w.s === 200 && w.j.data.every((x) => x.type === "STORE"));
ok("warehouses type=bad 400", (await api("GET", "/warehouses?type=zzz", A.kasir)).s === 400);

// ---- Validasi create
ok("create items kosong 400", (await api("POST", "/consignments", A.owner, mkBody(2, { items: [] }))).s === 400);
ok("create qty 0 400", (await api("POST", "/consignments", A.owner, mkBody(0))).s === 400);
ok("create qty desimal 400", (await api("POST", "/consignments", A.owner, mkBody(1.5))).s === 400);
ok("create harga negatif 400", (await api("POST", "/consignments", A.owner, { ...mkBody(), items: [{ productId: A.prod.id, qty: 1, agreedUnitPrice: -1 }] })).s === 400);
ok("create item ganda 400", (await api("POST", "/consignments", A.owner, { ...mkBody(), items: [{ productId: A.prod.id, qty: 1 }, { productId: A.prod.id, qty: 2 }] })).s === 400);
ok("create JSON rusak 400", (await api("POST", "/consignments", A.owner, null, "{bad")).s === 400);
ok("create note 1001 char 400", (await api("POST", "/consignments", A.owner, mkBody(2, { note: "x".repeat(1001) }))).s === 400);
ok("create dueDate invalid 400", (await api("POST", "/consignments", A.owner, mkBody(2, { dueDate: "bukan-tanggal" }))).s === 400);
const huge = await api("POST", "/consignments", A.owner, mkBody(1_000_000));
ok("create 1.000.000 Dus (24 juta base) bukan 500", huge.s !== 500, huge);
ok("create customer tenant lain 404", (await api("POST", "/consignments", A.owner, mkBody(2, { customerId: B.cust.id }))).s === 404);
ok("create gudang tenant lain 404", (await api("POST", "/consignments", A.owner, mkBody(2, { sourceWarehouseId: B.wh.id }))).s === 404);
ok("create produk tenant lain 404", (await api("POST", "/consignments", A.owner, { ...mkBody(), items: [{ productId: B.prod.id, qty: 1 }] })).s === 404);
ok("create satuan tenant lain 404", (await api("POST", "/consignments", A.owner, { ...mkBody(), items: [{ productId: A.prod.id, productUnitId: B.dus.id, qty: 1 }] })).s === 404);

// ---- Alur utama: kirim 2 Dus (48) -> terjual 30 Botol -> retur 18 -> SETTLED
const c = await api("POST", "/consignments", A.owner, mkBody(2));
ok("create 201 DRAFT", c.s === 201 && c.j.data.status === "DRAFT", c);
const cid = c.j.data.id;
const item = c.j.data.items[0];
ok("kontrak: field item", item.conversionQty === 24 && item.baseQtySent === 48 && item.unitLabel === "Dus" && item.baseQtyRemaining === 48, item);
ok("kontrak: summary nilai kirim 192000", c.j.data.summary.totalValueSent === 192000, c.j.data.summary);
const consignWhId = c.j.data.consignWarehouseId;
ok("consignment_no format", /^KNS-\d{8}-\d{4}$/.test(c.j.data.consignmentNo), c.j.data.consignmentNo);
ok("stok belum bergerak saat DRAFT", (await stock(A.prod.id, A.wh.id)) === 100);
ok("source = consign wh ditolak 400", (await api("POST", "/consignments", A.owner, mkBody(2, { sourceWarehouseId: consignWhId }))).s === 400);
ok("tenant B GET order A 404", (await api("GET", "/consignments/" + cid, B.owner)).s === 404);
ok("tenant B send order A 404", (await api("POST", `/consignments/${cid}/send`, B.owner, {})).s === 404);
ok("tenant B cancel order A 404", (await api("POST", `/consignments/${cid}/cancel`, B.owner, { reason: "xxx" })).s === 404);
ok("settle DRAFT 409", (await api("POST", `/consignments/${cid}/settle-sale`, A.owner, { lines: [{ consignmentItemId: item.id, qty: 1, useBaseUnit: true }] })).s === 409);
ok("return DRAFT 409", (await api("POST", `/consignments/${cid}/return`, A.owner, { lines: [{ consignmentItemId: item.id, qty: 1 }] })).s === 409);
const pu = await api("PUT", "/consignments/" + cid, A.owner, mkBody(2, { note: "ubah" }));
ok("PUT draft 200", pu.s === 200 && pu.j.data.note === "ubah", pu);
ok("PUT role kasir 403", (await api("PUT", "/consignments/" + cid, A.kasir, mkBody(2))).s === 403);
const big = await api("POST", "/consignments", A.owner, mkBody(100));
const bigSend = await api("POST", `/consignments/${big.j.data.id}/send`, A.owner, {});
ok("send stok kurang 400 INSUFFICIENT_STOCK", bigSend.s === 400 && bigSend.j?.code === "INSUFFICIENT_STOCK", bigSend);
ok("stok tetap 100 setelah gagal kirim", (await stock(A.prod.id, A.wh.id)) === 100);
ok("send role gudang 403", (await api("POST", `/consignments/${cid}/send`, A.gudang, {})).s === 403);
const sd = await api("POST", `/consignments/${cid}/send`, A.owner, {});
ok("send 200 SENT", sd.s === 200 && sd.j.data.status === "SENT", sd);
ok("stok source 52, consign 48", (await stock(A.prod.id, A.wh.id)) === 52 && (await stock(A.prod.id, consignWhId)) === 48);
ok("send ulang 409", (await api("POST", `/consignments/${cid}/send`, A.owner, {})).s === 409);
ok("PUT setelah SENT 409", (await api("PUT", "/consignments/" + cid, A.owner, mkBody(2))).s === 409);
const it = sd.j.data.items[0];
const bad = await api("POST", "/sales", A.kasir, { warehouseId: consignWhId, items: [{ productId: A.prod.id, qty: 1 }], payments: [{ method: "CASH", amount: 99999 }] });
ok("POST /sales gudang konsinyasi 400 CONSIGNMENT_WAREHOUSE", bad.s === 400 && bad.j?.code === "CONSIGNMENT_WAREHOUSE", bad);
ok("warehouses default tidak memuat consign", !(await api("GET", "/warehouses", A.kasir)).j.data.some((x) => x.id === consignWhId));
ok("warehouses ALL memuat consign", (await api("GET", "/warehouses?type=ALL", A.kasir)).j.data.some((x) => x.id === consignWhId && x.type === "CONSIGNMENT"));
ok("PUT warehouse consign 409", (await api("PUT", "/warehouses/" + consignWhId, A.owner, { name: "x" })).s === 409);
ok("DELETE warehouse consign 409", (await api("DELETE", "/warehouses/" + consignWhId, A.owner)).s === 409);
const ex1 = await api("POST", `/consignments/${cid}/settle-sale`, A.owner, { lines: [{ consignmentItemId: it.id, qty: 49, useBaseUnit: true }] });
ok("settle lebih dari sisa 400", ex1.j?.code === "EXCEEDS_REMAINING", ex1);
const ex2 = await api("POST", `/consignments/${cid}/settle-sale`, A.owner, { lines: [{ consignmentItemId: it.id, qty: 3 }] });
ok("settle 3 Dus (=72) > sisa 400", ex2.j?.code === "EXCEEDS_REMAINING", ex2);
ok("settle item bukan milik dokumen 404", (await api("POST", `/consignments/${cid}/settle-sale`, A.owner, { lines: [{ consignmentItemId: "nope", qty: 1 }] })).s === 404);
ok("settle role kasir 403", (await api("POST", `/consignments/${cid}/settle-sale`, A.kasir, { lines: [{ consignmentItemId: it.id, qty: 1, useBaseUnit: true }] })).s === 403);
ok("settle baris ganda 400", (await api("POST", `/consignments/${cid}/settle-sale`, A.owner, { lines: [{ consignmentItemId: it.id, qty: 1, useBaseUnit: true }, { consignmentItemId: it.id, qty: 1, useBaseUnit: true }] })).s === 400);
ok("settle payments amount negatif 400", (await api("POST", `/consignments/${cid}/settle-sale`, A.owner, { lines: [{ consignmentItemId: it.id, qty: 1, useBaseUnit: true }], payments: [{ method: "CASH", amount: -5 }] })).s === 400);
ok("settle taxPercent 101 400", (await api("POST", `/consignments/${cid}/settle-sale`, A.owner, { lines: [{ consignmentItemId: it.id, qty: 1, useBaseUnit: true }], taxPercent: 101 })).s === 400);
ok("stok tak berubah oleh percobaan gagal", (await stock(A.prod.id, consignWhId)) === 48);
const st = await api("POST", `/consignments/${cid}/settle-sale`, A.owner, { lines: [{ consignmentItemId: it.id, qty: 30, useBaseUnit: true }] });
ok("settle 30 Botol 201", st.s === 201, st);
const sale = st.j.data.sale;
const cons = st.j.data.consignment;
ok("sale PARTIAL, grand 133200, paid 0", sale.status === "PARTIAL" && Number(sale.grandTotal) === 133200 && Number(sale.paidTotal) === 0, { status: sale.status, g: sale.grandTotal });
ok("sale item harga 4000 konversi 1 qty 30", Number(sale.items[0].unitPrice) === 4000 && sale.items[0].conversionQty === 1 && sale.items[0].qty === 30, sale.items[0]);
ok("sale.consignmentOrderId terisi & customer outlet", sale.consignmentOrderId === cid && sale.customerId === A.cust.id);
ok("konsinyasi PARTIALLY_SETTLED sold=30 rem=18", cons.status === "PARTIALLY_SETTLED" && cons.items[0].baseQtySold === 30 && cons.items[0].baseQtyRemaining === 18, cons.items[0]);
ok("stok consign 18", (await stock(A.prod.id, consignWhId)) === 18);
ok("settlement invoiceNo ada", cons.settlements.some((x) => x.type === "SALE" && x.saleId === sale.id && x.invoiceNo === sale.invoiceNo));
ok("cancel SENT dg terjual 409", (await api("POST", `/consignments/${cid}/cancel`, A.owner, { reason: "coba" })).s === 409);
const os = await api("GET", "/consignments/outlet-stock?customerId=" + A.cust.id, A.kasir);
ok("outlet-stock 18 Botol", os.s === 200 && os.j.data[0]?.products[0]?.quantity === 18, os.j);
ok("outlet-stock tenant B kosong", (await api("GET", "/consignments/outlet-stock", B.owner)).j.data.length === 0);
const ar1 = await acctSum(A.t.id, "1200");
ok("piutang buku besar = 133200", Math.abs(ar1 - 133200) < 0.01, ar1);
const rx = await api("POST", `/consignments/${cid}/return`, A.owner, { lines: [{ consignmentItemId: it.id, qty: 19, useBaseUnit: true }] });
ok("retur lebih sisa 400", rx.j?.code === "EXCEEDS_REMAINING", rx);
ok("retur role gudang 403", (await api("POST", `/consignments/${cid}/return`, A.gudang, { lines: [{ consignmentItemId: it.id, qty: 18, useBaseUnit: true }] })).s === 403);
const rt = await api("POST", `/consignments/${cid}/return`, A.owner, { lines: [{ consignmentItemId: it.id, qty: 18, useBaseUnit: true }] });
ok("retur 18 -> SETTLED", rt.s === 200 && rt.j.data.status === "SETTLED" && rt.j.data.items[0].baseQtyReturned === 18, rt);
ok("stok source 70 consign 0", (await stock(A.prod.id, A.wh.id)) === 70 && (await stock(A.prod.id, consignWhId)) === 0, [await stock(A.prod.id, A.wh.id), await stock(A.prod.id, consignWhId)]);
ok("summary nilai sold 120000 returned 72000 remaining 0", rt.j.data.summary.totalValueRemaining === 0 && rt.j.data.summary.totalValueSold === 120000 && rt.j.data.summary.totalValueReturned === 72000, rt.j.data.summary);
ok("settle setelah SETTLED 409", (await api("POST", `/consignments/${cid}/settle-sale`, A.owner, { lines: [{ consignmentItemId: it.id, qty: 1, useBaseUnit: true }] })).s === 409);
// pelunasan piutang + jurnal
const p1 = await api("POST", `/sales/${sale.id}/payments`, A.kasir, { method: "CASH", amount: 100000 });
ok("bayar 100000 200 PARTIAL", p1.s === 200 && p1.j.data.status === "PARTIAL", p1);
const ar2 = await acctSum(A.t.id, "1200"), kas2 = await acctSum(A.t.id, "1000");
ok("piutang turun jadi 33200 & kas +100000", Math.abs(ar2 - 33200) < 0.01 && Math.abs(kas2 - 100000) < 0.01, [ar2, kas2]);
const p2 = await api("POST", `/sales/${sale.id}/payments`, A.kasir, { method: "TRANSFER", amount: 50000 });
ok("bayar lebih 50000 -> PAID kembalian 16800", p2.s === 200 && p2.j.data.status === "PAID" && Number(p2.j.data.changeAmount) === 16800, p2.j);
const ar3 = await acctSum(A.t.id, "1200"), bank3 = await acctSum(A.t.id, "1100");
ok("piutang 0 & bank +33200 (kembalian tak dijurnal)", Math.abs(ar3) < 0.01 && Math.abs(bank3 - 33200) < 0.01, [ar3, bank3]);
ok("bayar PAID 409", (await api("POST", `/sales/${sale.id}/payments`, A.kasir, { method: "CASH", amount: 1000 })).s === 409);
ok("cancel sale role kasir 403", (await api("POST", `/sales/${sale.id}/cancel`, A.kasir, { reason: "tes batal" })).s === 403);
ok("cancel sale tenant B 404", (await api("POST", `/sales/${sale.id}/cancel`, B.owner, { reason: "tes batal" })).s === 404);
const cs = await api("POST", `/sales/${sale.id}/cancel`, A.owner, { reason: "tes batal" });
ok("cancel sale 200", cs.s === 200, cs);
const after = (await api("GET", "/consignments/" + cid, A.owner)).j.data;
ok("stok consign +30 (kembali ke outlet)", (await stock(A.prod.id, consignWhId)) === 30, await stock(A.prod.id, consignWhId));
ok("baseQtySold 0, PARTIALLY_SETTLED, settlement void", after.items[0].baseQtySold === 0 && after.status === "PARTIALLY_SETTLED" && !!after.settlements.find((x) => x.type === "SALE").voidedAt, after);
ok("INVARIAN: sold+returned+stok outlet = 48", after.items[0].baseQtyReturned + after.items[0].baseQtySold + (await stock(A.prod.id, consignWhId)) === 48);
ok("remaining 30 == stok outlet 30", after.items[0].baseQtyRemaining === 30);
const js = [await acctSum(A.t.id, "1200"), await acctSum(A.t.id, "4000"), await acctSum(A.t.id, "1000"), await acctSum(A.t.id, "1100")];
ok("jurnal setelah cancel: piutang/pendapatan/kas/bank = 0", js.every((v) => Math.abs(v) < 0.01), js);
ok("cancel sale ganda 409", (await api("POST", `/sales/${sale.id}/cancel`, A.owner, { reason: "tes batal" })).s === 409);
const st2 = await api("POST", `/consignments/${cid}/settle-sale`, A.owner, { lines: [{ consignmentItemId: it.id, qty: 1 }], payments: [{ method: "QRIS", amount: 106560 }] });
ok("settle 1 Dus 201 PAID (96000*1.11=106560)", st2.s === 201 && st2.j.data.sale.status === "PAID" && Number(st2.j.data.sale.grandTotal) === 106560, st2.j);
ok("stok outlet 6 (30-24)", (await stock(A.prod.id, consignWhId)) === 6);
ok("sale item Dus konversi 24", st2.j.data.sale.items[0].conversionQty === 24 && st2.j.data.sale.items[0].qty === 1);
await api("POST", `/sales/${st2.j.data.sale.id}/cancel`, A.owner, { reason: "batal dus" });
ok("cancel sale Dus -> stok outlet 30 (+24)", (await stock(A.prod.id, consignWhId)) === 30, await stock(A.prod.id, consignWhId));

// ---- Regresi POST /sales biasa
const s0 = await stock(A.prod.id, A.wh.id);
const rs = await api("POST", "/sales", A.kasir, { warehouseId: A.wh.id, customerId: A.cust.id, items: [{ productId: A.prod.id, productUnitId: A.dus.id, qty: 2 }], payments: [{ method: "CASH", amount: 300000 }] });
ok("POST /sales 2 Dus 201", rs.s === 201, rs);
ok("stok -48", (await stock(A.prod.id, A.wh.id)) === s0 - 48);
ok("POST /sales customer tenant lain 404", (await api("POST", "/sales", A.kasir, { warehouseId: A.wh.id, customerId: B.cust.id, items: [{ productId: A.prod.id, qty: 1 }], payments: [{ method: "CASH", amount: 99999 }] })).s === 404);
ok("POST /sales stok kurang 400", (await api("POST", "/sales", A.kasir, { warehouseId: A.wh.id, items: [{ productId: A.prod.id, qty: 99999 }], payments: [{ method: "CASH", amount: 1 }] })).s === 400);
await api("POST", `/sales/${rs.j.data.id}/cancel`, A.owner, { reason: "batal reguler" });
ok("cancel sale 2 Dus -> stok kembali (+48)", (await stock(A.prod.id, A.wh.id)) === s0, [await stock(A.prod.id, A.wh.id), s0]);

// ---- Cancel dari SENT & DRAFT
const c2 = await api("POST", "/consignments", A.owner, mkBody(1));
await api("POST", `/consignments/${c2.j.data.id}/send`, A.owner, {});
const s1 = await stock(A.prod.id, A.wh.id);
ok("cancel alasan pendek 400", (await api("POST", `/consignments/${c2.j.data.id}/cancel`, A.owner, { reason: "x" })).s === 400);
const cc = await api("POST", `/consignments/${c2.j.data.id}/cancel`, A.owner, { reason: "salah kirim" });
ok("cancel SENT 200 CANCELLED", cc.s === 200 && cc.j.data.status === "CANCELLED" && cc.j.data.cancelReason === "salah kirim", cc);
ok("stok source +24 kembali", (await stock(A.prod.id, A.wh.id)) === s1 + 24);
ok("cancel CANCELLED 409", (await api("POST", `/consignments/${c2.j.data.id}/cancel`, A.owner, { reason: "lagi" })).s === 409);
ok("cancel DRAFT 200", (await api("POST", `/consignments/${big.j.data.id}/cancel`, A.owner, { reason: "batal draf" })).s === 200);

// ---- Balapan (race)
const c3 = await api("POST", "/consignments", A.owner, mkBody(1));
const rr = await Promise.all([1, 2, 3].map(() => api("POST", `/consignments/${c3.j.data.id}/send`, A.owner, {})));
ok("send paralel: tepat 1 sukses", rr.filter((x) => x.s === 200).length === 1, rr.map((x) => x.s));
ok("send paralel: stok consign +24 saja", (await stock(A.prod.id, consignWhId)) === 30 + 24, await stock(A.prod.id, consignWhId));
const i3 = (await api("GET", "/consignments/" + c3.j.data.id, A.owner)).j.data.items[0];
const sr = await Promise.all([1, 2, 3].map(() => api("POST", `/consignments/${c3.j.data.id}/settle-sale`, A.owner, { lines: [{ consignmentItemId: i3.id, qty: 24, useBaseUnit: true }] })));
ok("settle paralel penuh: tepat 1 sukses", sr.filter((x) => x.s === 201).length === 1, sr.map((x) => x.s));
const d3 = (await api("GET", "/consignments/" + c3.j.data.id, A.owner)).j.data;
ok("sold<=sent setelah balapan, SETTLED", d3.items[0].baseQtySold === 24 && d3.status === "SETTLED", d3);
ok("tidak ada stok negatif di DB", (await db.stock.findMany({ where: { quantity: { lt: 0 } } })).length === 0);
const sale3 = sr.find((x) => x.s === 201)?.j.data.sale;
const cr = await Promise.all([1, 2, 3].map(() => api("POST", `/sales/${sale3.id}/cancel`, A.owner, { reason: "balapan cancel" })));
ok("cancel sale paralel: tepat 1 sukses", cr.filter((x) => x.s === 200).length === 1, cr.map((x) => x.s));
ok("stok outlet balik 54 tepat sekali", (await stock(A.prod.id, consignWhId)) === 54, await stock(A.prod.id, consignWhId));
const c4 = await api("POST", "/consignments", A.owner, mkBody(1));
await api("POST", `/consignments/${c4.j.data.id}/send`, A.owner, {});
const i4 = (await api("GET", "/consignments/" + c4.j.data.id, A.owner)).j.data.items[0];
const s4 = await api("POST", `/consignments/${c4.j.data.id}/settle-sale`, A.owner, { lines: [{ consignmentItemId: i4.id, qty: 24, useBaseUnit: true }] });
const gt4 = Number(s4.j.data.sale.grandTotal);
const pr = await Promise.all([1, 2, 3].map(() => api("POST", `/sales/${s4.j.data.sale.id}/payments`, A.kasir, { method: "CASH", amount: gt4 })));
console.log("   pembayaran paralel status:", pr.map((x) => x.s));
ok("pembayaran paralel penuh: tepat 1 sukses (tak ada double-jurnal)", pr.filter((x) => x.s === 200).length === 1, pr.map((x) => x.s));

// ---- Guard gudang konsinyasi di endpoint lain
const sm = await api("POST", "/stock-movements", A.owner, { productId: A.prod.id, warehouseId: consignWhId, direction: "IN", qty: 5, note: "uji adjust" });
ok("(guard) stock-movements ke gudang konsinyasi ditolak", sm.s >= 400 && sm.s < 500, sm);

// ---- REGRESI putaran 2 (BUG-001/002/003)
{
  const before = await stock(A.prod.id, consignWhId);
  const sm2 = await api("POST", "/stock-movements", A.owner, { productId: A.prod.id, warehouseId: consignWhId, direction: "IN", qty: 5, note: "regresi" });
  ok("BUG-001 stock-movements IN gudang konsinyasi -> 400 CONSIGNMENT_WAREHOUSE", sm2.s === 400 && sm2.j?.code === "CONSIGNMENT_WAREHOUSE", sm2);
  const sm3 = await api("POST", "/stock-movements", A.owner, { productId: A.prod.id, warehouseId: consignWhId, direction: "OUT", qty: 1, note: "regresi" });
  ok("BUG-001 stock-movements OUT gudang konsinyasi -> 400 CONSIGNMENT_WAREHOUSE", sm3.s === 400 && sm3.j?.code === "CONSIGNMENT_WAREHOUSE", sm3);
  const po1 = await api("POST", "/purchase-orders", A.owner, { warehouseId: consignWhId, paymentMethod: "CASH", items: [{ productId: A.prod.id, qty: 5, unitCost: 1000 }] });
  ok("BUG-001 purchase-orders ke gudang konsinyasi -> 400 CONSIGNMENT_WAREHOUSE", po1.s === 400 && po1.j?.code === "CONSIGNMENT_WAREHOUSE", po1);
  ok("BUG-001 stok gudang konsinyasi tak berubah", (await stock(A.prod.id, consignWhId)) === before);
  const sm4 = await api("POST", "/stock-movements", A.owner, { productId: A.prod.id, warehouseId: A.wh.id, direction: "IN", qty: 1, note: "regresi normal" });
  ok("BUG-001 stock-movements gudang STORE normal tetap sukses", sm4.s >= 200 && sm4.s < 300, sm4);
  const po2 = await api("POST", "/purchase-orders", A.owner, { warehouseId: A.wh.id, paymentMethod: "CREDIT", items: [{ productId: A.prod.id, qty: 5, unitCost: 1000 }] });
  ok("BUG-001 purchase-orders gudang STORE normal tetap sukses", po2.s >= 200 && po2.s < 300 && !!po2.j?.data?.id, po2);
  if (po2.j?.data?.id) {
    const rc = await api("POST", `/purchase-orders/${po2.j.data.id}/receive`, A.owner, {});
    ok("PO terima barang", rc.s >= 200 && rc.s < 300, rc);
    const pp = await Promise.all([1, 2, 3, 4].map(() => api("POST", `/purchase-orders/${po2.j.data.id}/payments`, A.owner, { method: "CASH", amount: 5000 })));
    console.log("   pembayaran PO paralel status:", pp.map((x) => `${x.s}${x.j?.code ? ":" + x.j.code : ""}`));
    ok("BUG-002 pembayaran PO paralel: tidak ada 500", pp.every((x) => x.s !== 500), pp.map((x) => x.s));
    ok("BUG-002 pembayaran PO paralel: tepat 1 sukses", pp.filter((x) => x.s >= 200 && x.s < 300).length === 1, pp.map((x) => x.s));
    ok("BUG-002 PO gagal paralel = 409", pp.filter((x) => x.s >= 400).every((x) => x.s === 409), pp.map((x) => [x.s, x.j?.code]));
  }
  const c5 = await api("POST", "/consignments", A.owner, mkBody(1));
  await api("POST", `/consignments/${c5.j.data.id}/send`, A.owner, {});
  const i5 = (await api("GET", "/consignments/" + c5.j.data.id, A.owner)).j.data.items[0];
  const s5 = await api("POST", `/consignments/${c5.j.data.id}/settle-sale`, A.owner, { lines: [{ consignmentItemId: i5.id, qty: 24, useBaseUnit: true }] });
  const gt5 = Number(s5.j.data.sale.grandTotal);
  const pr5 = await Promise.all([1, 2, 3, 4, 5].map(() => api("POST", `/sales/${s5.j.data.sale.id}/payments`, A.kasir, { method: "CASH", amount: gt5 })));
  console.log("   pembayaran sale paralel status:", pr5.map((x) => `${x.s}${x.j?.code ? ":" + x.j.code : ""}`));
  ok("BUG-002 pembayaran sale paralel: tidak ada 500", pr5.every((x) => x.s !== 500), pr5.map((x) => x.s));
  ok("BUG-002 sale paralel: tepat 1 sukses, sisanya 409", pr5.filter((x) => x.s === 200).length === 1 && pr5.filter((x) => x.s !== 200).every((x) => x.s === 409), pr5.map((x) => [x.s, x.j?.code]));
  const many = [];
  for (let k = 0; k < 40; k++) {
    const p = await db.product.create({ data: { tenantId: A.t.id, name: "Bulk" + k, sku: "BK-" + k + "-" + Date.now(), unit: "Pcs", costPrice: 1000, sellPrice: 2000 } });
    await db.stock.create({ data: { tenantId: A.t.id, productId: p.id, warehouseId: A.wh.id, quantity: 100 } });
    many.push({ productId: p.id, qty: 5 });
  }
  const cb = await api("POST", "/consignments", A.owner, { customerId: A.cust.id, sourceWarehouseId: A.wh.id, items: many });
  const t0 = Date.now();
  const sb = await api("POST", `/consignments/${cb.j?.data?.id}/send`, A.owner, {});
  console.log(`   send 40 item: ${sb.s} ${Date.now() - t0}ms`);
  ok("BUG-003 send 40 item sukses (tanpa timeout transaksi)", sb.s >= 200 && sb.s < 300, sb);
  const ib = (await api("GET", "/consignments/" + cb.j.data.id, A.owner)).j.data.items;
  const sbs = await api("POST", `/consignments/${cb.j.data.id}/settle-sale`, A.owner, { lines: ib.map((i) => ({ consignmentItemId: i.id, qty: 3 })) });
  ok("BUG-003 settle-sale 40 item sukses", sbs.s === 201, sbs);
  const rb = await api("POST", `/consignments/${cb.j.data.id}/return`, A.owner, { lines: ib.map((i) => ({ consignmentItemId: i.id, qty: 2 })) });
  ok("BUG-003 return 40 item sukses", rb.s >= 200 && rb.s < 300, rb);
}

// ---- List/filter/pagination
ok("list status invalid 400", (await api("GET", "/consignments?status=XX", A.kasir)).s === 400);
const L = await api("GET", "/consignments?pageSize=2&page=1", A.kasir);
ok("list pagination", L.s === 200 && L.j.data.length === 2 && L.j.pagination.total >= 4 && !("items" in L.j.data[0]), L.j.pagination);
ok("list pageSize=abc tidak 500", (await api("GET", "/consignments?pageSize=abc&page=-1", A.kasir)).s === 200);
ok("list tenant B kosong", (await api("GET", "/consignments", B.owner)).j.data.length === 0);
ok("list filter customerId tenant lain kosong", (await api("GET", "/consignments?customerId=" + B.cust.id, A.owner)).j.data.length === 0);

// ---- FREE limit pada settle
const F = await mkTenant("F", "FREE");
const fc = await api("POST", "/consignments", F.owner, { customerId: F.cust.id, sourceWarehouseId: F.wh.id, items: [{ productId: F.prod.id, qty: 50 }] });
await api("POST", `/consignments/${fc.j.data.id}/send`, F.owner, {});
const fi = (await api("GET", "/consignments/" + fc.j.data.id, F.owner)).j.data.items[0];
const codes = [];
for (let k = 0; k < 11; k++) codes.push(await api("POST", `/consignments/${fc.j.data.id}/settle-sale`, F.owner, { lines: [{ consignmentItemId: fi.id, qty: 1 }] }));
ok("FREE: 10 settle ok, ke-11 403 FREE_LIMIT_REACHED", codes.slice(0, 10).every((x) => x.s === 201) && codes[10].s === 403 && codes[10].j.code === "FREE_LIMIT_REACHED", codes.map((x) => x.s));

// ---- Neraca jurnal global
const entries = await db.journalEntry.findMany({ include: { lines: true } });
const unbal = entries.filter((e) => Math.abs(e.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)) > 0.01);
ok("semua jurnal balance", unbal.length === 0, unbal.map((e) => e.referenceType));

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`);
if (failures.length) console.log("GAGAL:", failures);
await db.$disconnect();
process.exit(fail ? 1 : 0);
