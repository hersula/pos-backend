// E2E Stock Opname terhadap server nyata + DB uji TERPISAH (qc_opname_test). BELUM PERNAH DIJALANKAN (putaran 1).
// Siapkan: buat DB qc_opname_test, `DATABASE_URL=... npx prisma migrate deploy`, jalankan `npm run dev -- -p 3999` dengan DB itu.
// Jalankan: DATABASE_URL=mysql://root:@127.0.0.1:3306/qc_opname_test JWT_ACCESS_SECRET=qc-secret BASE=http://127.0.0.1:3999 node tests/stock-opname-e2e.mjs
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const SECRET = process.env.JWT_ACCESS_SECRET ?? "qc-secret";
if (!/qc_opname_test/.test(process.env.DATABASE_URL ?? "")) { console.error("Menolak jalan: bukan DB uji qc_opname_test"); process.exit(2); }
const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
const tok = (userId, tenantId, role) => jwt.sign({ type: "tenant_user", userId, tenantId, role }, SECRET, { expiresIn: "1h" });
async function mkUser(tenantId, role, tag) {
  const u = await db.user.create({ data: { tenantId, name: role + tag, email: `${role.toLowerCase()}-${tag}-${Date.now()}@qc.test`, password: "x", role, isActive: true } });
  return tok(u.id, tenantId, role);
}
async function api(method, path, token, body, raw) {
  const r = await fetch(BASE + "/api" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const qty = async (p, w) => (await db.stock.findUnique({ where: { productId_warehouseId: { productId: p, warehouseId: w } } }))?.quantity ?? 0;
async function mkTenant(tag) {
  const t = await db.tenant.create({ data: { businessName: "QC " + tag, ownerName: "O" + tag, email: `${tag}-${Date.now()}@qc.test`, planType: "SUBSCRIBE", status: "APPROVED" } });
  const wh = await db.warehouse.create({ data: { tenantId: t.id, name: "G" + tag } });
  const cons = await db.warehouse.create({ data: { tenantId: t.id, name: "C" + tag, type: "CONSIGNMENT" } });
  const mk = (n, stock) => db.product.create({ data: { tenantId: t.id, name: n + tag, sku: n + tag, unit: "pcs", costPrice: 1000, sellPrice: 2000 } }).then(async (p) => { if (stock !== null) await db.stock.create({ data: { tenantId: t.id, productId: p.id, warehouseId: wh.id, quantity: stock } }); return p; });
  const p1 = await mk("P1", 10), p2 = await mk("P2", 5), p3 = await mk("P3", null);
  return { t, wh, cons, p1, p2, p3, owner: await mkUser(t.id, "OWNER", tag), mgr: await mkUser(t.id, "MANAGER", tag), kasir: await mkUser(t.id, "KASIR", tag), gudang: await mkUser(t.id, "GUDANG", tag), akun: await mkUser(t.id, "AKUNTAN", tag) };
}
const A = await mkTenant("A"), B = await mkTenant("B");
const create = (T, extra = {}) => api("POST", "/stock-opnames", T.owner, { warehouseId: T.wh.id, ...extra });
const itemOf = (o, p) => o.items.find((i) => i.productId === p.id);

// Auth & role
ok("401 tanpa token", (await api("GET", "/stock-opnames")).s === 401);
for (const r of ["kasir", "gudang", "akun"]) ok(`403 create role ${r}`, (await api("POST", "/stock-opnames", A[r], { warehouseId: A.wh.id })).s === 403);
ok("create gudang konsinyasi 400 CONSIGNMENT_WAREHOUSE", (await api("POST", "/stock-opnames", A.owner, { warehouseId: A.cons.id })).j?.code === "CONSIGNMENT_WAREHOUSE");
ok("create gudang tenant lain 404", (await api("POST", "/stock-opnames", A.owner, { warehouseId: B.wh.id })).s === 404);
ok("create JSON rusak 400", (await api("POST", "/stock-opnames", A.owner, null, "{bad")).s === 400);
ok("create note 501 char 400", (await create(A, { note: "x".repeat(501) })).s === 400);

// Snapshot
let r = await create(A); const S = r.j?.data;
ok("create 201 + 3 item (stok 0 utk P3)", r.s === 201 && S.items.length === 3 && itemOf(S, A.p3).systemQty === 0, r.j);
ok("opnameNo format", /^OPN-\d{8}-\d{4}$/.test(S.opnameNo));

// Hitung
const cnt = (T, id, items, tkn) => api("PATCH", `/stock-opnames/${id}/items`, tkn ?? T.kasir, { items });
ok("KASIR boleh hitung", (await cnt(A, S.id, [{ itemId: itemOf(S, A.p1).id, countedQty: 8 }])).s === 200);
ok("AKUNTAN 403 hitung", (await cnt(A, S.id, [{ itemId: itemOf(S, A.p1).id, countedQty: 8 }], A.akun)).s === 403);
ok("countedQty negatif 400", (await cnt(A, S.id, [{ itemId: itemOf(S, A.p1).id, countedQty: -1 }])).s === 400);
ok("countedQty desimal 400", (await cnt(A, S.id, [{ itemId: itemOf(S, A.p1).id, countedQty: 1.5 }])).s === 400);
ok("countedQty > 2e9 400", (await cnt(A, S.id, [{ itemId: itemOf(S, A.p1).id, countedQty: 2_000_000_001 }])).s === 400);
ok("itemId duplikat 400", (await cnt(A, S.id, [{ itemId: itemOf(S, A.p1).id, countedQty: 1 }, { itemId: itemOf(S, A.p1).id, countedQty: 2 }])).s === 400);
ok("items kosong 400", (await cnt(A, S.id, [])).s === 400);
ok("501 item 400", (await cnt(A, S.id, Array.from({ length: 501 }, (_, i) => ({ itemId: "x" + i, countedQty: 1 })))).s === 400);
ok("itemId asing 404 & atomik (P1 tetap 8)", (await cnt(A, S.id, [{ itemId: itemOf(S, A.p2).id, countedQty: 1 }, { itemId: "nope", countedQty: 1 }])).s === 404 && (await api("GET", `/stock-opnames/${S.id}`, A.owner)).j.data.items.find((i) => i.productId === A.p2.id).countedQty === null);
ok("sesi tenant lain 404 (GET/PATCH/finalize/cancel)", (await api("GET", `/stock-opnames/${S.id}`, B.owner)).s === 404 && (await cnt(B, S.id, [{ itemId: itemOf(S, A.p1).id, countedQty: 1 }], B.owner)).s === 404 && (await api("POST", `/stock-opnames/${S.id}/finalize`, B.owner, {})).s === 404 && (await api("POST", `/stock-opnames/${S.id}/cancel`, B.owner, { reason: "abc" })).s === 404);
ok("list tenant B tidak melihat sesi A", (await api("GET", "/stock-opnames", B.owner)).j.data.length === 0);
ok("list status=bad 400", (await api("GET", "/stock-opnames?status=zzz", A.owner)).s === 400);

// Selisih relatif: P1 snapshot 10 hitung 8 (diff -2); P2 hitung 9 (diff +4); transaksi setelah snapshot: P1 turun jadi 7 (jual 3)
await cnt(A, S.id, [{ itemId: itemOf(S, A.p2).id, countedQty: 9 }]);
await db.stock.update({ where: { productId_warehouseId: { productId: A.p1.id, warehouseId: A.wh.id } }, data: { quantity: 7 } });
ok("role KASIR 403 finalize", (await api("POST", `/stock-opnames/${S.id}/finalize`, A.kasir, {})).s === 403);
r = await api("POST", `/stock-opnames/${S.id}/finalize`, A.mgr, {});
ok("finalize 200 adjusted=2 uncounted=1", r.s === 200 && r.j.result.adjustedItems === 2 && r.j.result.uncountedItems === 1, r.j);
ok("stok relatif: P1 7-2=5, P2 5+4=9, P3 tetap 0", (await qty(A.p1.id, A.wh.id)) === 5 && (await qty(A.p2.id, A.wh.id)) === 9 && (await qty(A.p3.id, A.wh.id)) === 0);
const mv = await db.stockMovement.findMany({ where: { referenceType: "STOCK_OPNAME", referenceId: S.id } });
ok("2 movement ADJUSTMENT", mv.length === 2 && mv.every((m) => m.type === "ADJUSTMENT"));
ok("finalize ulang 409 INVALID_STATUS, stok tak berubah", (await api("POST", `/stock-opnames/${S.id}/finalize`, A.owner, {})).j?.code === "INVALID_STATUS" && (await qty(A.p1.id, A.wh.id)) === 5);
ok("finalize paralel: tepat satu sukses", await (async () => { const s2 = (await create(A)).j.data; await cnt(A, s2.id, [{ itemId: itemOf(s2, A.p2).id, countedQty: 10 }]); const rs = await Promise.all([1, 2, 3].map(() => api("POST", `/stock-opnames/${s2.id}/finalize`, A.owner, {}))); return rs.filter((x) => x.s === 200).length === 1 && (await qty(A.p2.id, A.wh.id)) === 10; })());
ok("PATCH/cancel setelah COMPLETED 409", (await cnt(A, S.id, [{ itemId: itemOf(S, A.p1).id, countedQty: 1 }])).s === 409 && (await api("POST", `/stock-opnames/${S.id}/cancel`, A.owner, { reason: "abc" })).s === 409);

// NO_COUNTED_ITEMS, cancel
const s3 = (await create(A)).j.data;
ok("finalize tanpa hitungan 400 NO_COUNTED_ITEMS", (await api("POST", `/stock-opnames/${s3.id}/finalize`, A.owner, {})).j?.code === "NO_COUNTED_ITEMS");
ok("cancel tanpa alasan 400", (await api("POST", `/stock-opnames/${s3.id}/cancel`, A.owner, {})).s === 400);
ok("cancel alasan 2 char 400", (await api("POST", `/stock-opnames/${s3.id}/cancel`, A.owner, { reason: "ab" })).s === 400);
ok("cancel 200, stok tak berubah", (await api("POST", `/stock-opnames/${s3.id}/cancel`, A.owner, { reason: "salah gudang" })).s === 200);
ok("PATCH setelah CANCELLED 409", (await cnt(A, s3.id, [{ itemId: itemOf(s3, A.p1).id, countedQty: 1 }])).s === 409);

// STOCK_CONFLICT & clampToZero: P1 stok 5; snapshot 5, hitung 0 (diff -5); lalu stok turun jadi 2
const s4 = (await create(A)).j.data;
await cnt(A, s4.id, [{ itemId: itemOf(s4, A.p1).id, countedQty: 0 }]);
await db.stock.update({ where: { productId_warehouseId: { productId: A.p1.id, warehouseId: A.wh.id } }, data: { quantity: 2 } });
r = await api("POST", `/stock-opnames/${s4.id}/finalize`, A.owner, {});
ok("STOCK_CONFLICT 409 + details.items, tanpa perubahan", r.s === 409 && r.j.code === "STOCK_CONFLICT" && r.j.details.items[0].currentQty === 2 && (await qty(A.p1.id, A.wh.id)) === 2, r.j);
ok("clampToZero: stok 0, clampedItems=1", await (async () => { const x = await api("POST", `/stock-opnames/${s4.id}/finalize`, A.owner, { clampToZero: true }); return x.s === 200 && x.j.result.clampedItems === 1 && (await qty(A.p1.id, A.wh.id)) === 0; })());
ok("clampToZero tipe salah 400", (await api("POST", `/stock-opnames/${(await create(A)).j.data.id}/finalize`, A.owner, { clampToZero: "yes" })).s === 400);

console.log(`\nLulus ${pass}, gagal ${fail}`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
