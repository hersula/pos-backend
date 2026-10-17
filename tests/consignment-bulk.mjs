// Uji beban: dokumen konsinyasi 200 baris (batas maksimal kontrak) -> send & settle-sale, ukur waktu / timeout transaksi Prisma (5 dtk default).
// Jalankan: DATABASE_URL=mysql://root:@127.0.0.1:3306/qc_consign_test JWT_ACCESS_SECRET=qc-secret node tests/consignment-bulk.mjs
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
if (!/qc_consign_test/.test(process.env.DATABASE_URL ?? "")) { console.error("Menolak: bukan DB uji"); process.exit(2); }
const db = new PrismaClient();
const t = await db.tenant.create({ data: { businessName: "QC Bulk", ownerName: "Bulk Owner", email: `bulk-${Date.now()}@qc.test`, planType: "SUBSCRIBE", status: "APPROVED" } });
for (const [code, name, type] of [["1000", "Kas", "ASSET"], ["1100", "Bank", "ASSET"], ["1200", "Piutang", "ASSET"], ["1300", "Persediaan", "ASSET"], ["2100", "PPN", "LIABILITY"], ["4000", "Pendapatan", "REVENUE"], ["5000", "HPP", "EXPENSE"]])
  await db.chartOfAccount.create({ data: { tenantId: t.id, code, name, type } });
const wh = await db.warehouse.create({ data: { tenantId: t.id, name: "G" } });
const cust = await db.customer.create({ data: { tenantId: t.id, name: "Toko Bulk" } });
const u = await db.user.create({ data: { tenantId: t.id, name: "o", email: `o-${Date.now()}@qc.test`, password: "x", role: "OWNER", isActive: true } });
const token = jwt.sign({ type: "tenant_user", userId: u.id, tenantId: t.id, role: "OWNER" }, process.env.JWT_ACCESS_SECRET ?? "qc-secret");
const ids = [];
for (let i = 0; i < 200; i++) {
  const p = await db.product.create({ data: { tenantId: t.id, name: "P" + i, unit: "pcs", costPrice: 100, sellPrice: 500 } });
  await db.stock.create({ data: { tenantId: t.id, productId: p.id, warehouseId: wh.id, quantity: 10 } });
  ids.push(p.id);
}
async function api(method, path, body) {
  const t0 = Date.now();
  const r = await fetch(BASE + "/api" + path, { method, headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  return { s: r.status, ms: Date.now() - t0, j };
}
const c = await api("POST", "/consignments", { customerId: cust.id, sourceWarehouseId: wh.id, items: ids.map((id) => ({ productId: id, qty: 5 })) });
console.log("create 200 baris:", c.s, c.ms + "ms");
const s = await api("POST", `/consignments/${c.j.data.id}/send`, {});
console.log("send 200 baris:", s.s, s.ms + "ms", s.j?.message);
const items = (await api("GET", `/consignments/${c.j.data.id}`)).j.data.items;
const st = await api("POST", `/consignments/${c.j.data.id}/settle-sale`, { lines: items.map((i) => ({ consignmentItemId: i.id, qty: 2 })) });
console.log("settle 200 baris:", st.s, st.ms + "ms", st.j?.message);
await db.$disconnect();
