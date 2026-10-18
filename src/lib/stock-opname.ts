import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ConsignError } from "@/lib/consignment";

export { ConsignError as OpnameError, handleConsignError as handleOpnameError, parseBody } from "@/lib/consignment";

type TxClient = Prisma.TransactionClient;
type Client = TxClient | typeof prisma;

export const MAX_QTY = 2_000_000_000;
export const OPNAME_STATUSES = ["DRAFT", "COMPLETED", "CANCELLED"] as const;

export const createSchema = z.object({
  warehouseId: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  note: z.string().max(500).optional(),
});

export const countSchema = z.object({
  items: z
    .array(z.object({ itemId: z.string().min(1), countedQty: z.number().int().min(0).max(MAX_QTY).nullable() }))
    .min(1, "Minimal 1 item")
    .max(500, "Maksimal 500 item per request")
    .refine((a) => new Set(a.map((i) => i.itemId)).size === a.length, "itemId tidak boleh duplikat"),
});

export const finalizeSchema = z.object({ clampToZero: z.boolean().optional() }).default({});
export const cancelSchema = z.object({ reason: z.string().min(3, "Alasan pembatalan wajib diisi").max(500) });

export const HEADER_INCLUDE = { warehouse: { select: { id: true, name: true } } } as const;

const num = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);

export async function lockOpname(tx: TxClient, tenantId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM stock_opnames WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`;
  if (rows.length === 0) throw new ConsignError(404, "Sesi opname tidak ditemukan");
}

export function assertDraft(o: { status: string }, label: string) {
  if (o.status !== "DRAFT") {
    throw new ConsignError(409, `Sesi opname berstatus ${o.status}, tidak bisa ${label}`, "INVALID_STATUS");
  }
}

export async function loadOpnameOrThrow(client: Client, tenantId: string, id: string) {
  const o = await client.stockOpname.findFirst({ where: { id, tenantId }, include: HEADER_INCLUDE });
  if (!o) throw new ConsignError(404, "Sesi opname tidak ditemukan");
  return o;
}

export async function generateOpnameNo(tx: TxClient, tenantId: string) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const prefix = `OPN-${dateStr}-`;
  const last = await tx.stockOpname.findFirst({
    where: { tenantId, opnameNo: { startsWith: prefix } },
    orderBy: { opnameNo: "desc" },
    select: { opnameNo: true },
  });
  const lastSeq = last ? Number(last.opnameNo.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, "0")}`;
}

/** Ringkasan per sesi (dihitung dari item, bukan disimpan). */
export async function summarize(client: Client, ids: string[]) {
  const out = new Map<string, ReturnType<typeof emptySummary>>();
  for (const id of ids) out.set(id, emptySummary());
  if (ids.length === 0) return out;

  const [all, counted, plus, minus, clamped] = await Promise.all([
    client.stockOpnameItem.groupBy({ by: ["stockOpnameId"], where: { stockOpnameId: { in: ids } }, _count: { _all: true } }),
    client.stockOpnameItem.groupBy({ by: ["stockOpnameId"], where: { stockOpnameId: { in: ids }, countedQty: { not: null } }, _count: { _all: true } }),
    client.stockOpnameItem.groupBy({ by: ["stockOpnameId"], where: { stockOpnameId: { in: ids }, diff: { gt: 0 } }, _sum: { diff: true, diffValue: true } }),
    client.stockOpnameItem.groupBy({ by: ["stockOpnameId"], where: { stockOpnameId: { in: ids }, diff: { lt: 0 } }, _sum: { diff: true, diffValue: true } }),
    // Item hasil finalisasi yang appliedDiff-nya berbeda dari diff (di-clamp): summary memakai appliedDiff
    client.stockOpnameItem.findMany({
      where: { stockOpnameId: { in: ids }, appliedDiff: { not: null } },
      select: { stockOpnameId: true, diff: true, appliedDiff: true, unitCost: true },
    }),
  ]);
  for (const r of all) out.get(r.stockOpnameId)!.totalItems = r._count._all;
  for (const r of counted) out.get(r.stockOpnameId)!.countedItems = r._count._all;
  for (const r of plus) {
    const s = out.get(r.stockOpnameId)!;
    s.surplusQty = r._sum.diff ?? 0;
    s.surplusValue = num(r._sum.diffValue);
  }
  for (const r of minus) {
    const s = out.get(r.stockOpnameId)!;
    s.shortageQty = Math.abs(r._sum.diff ?? 0);
    s.shortageValue = Math.abs(num(r._sum.diffValue));
  }
  for (const c of clamped) {
    if (c.appliedDiff === null || c.appliedDiff === c.diff) continue;
    const s = out.get(c.stockOpnameId)!;
    // diff negatif dikoreksi ke appliedDiff (lebih kecil magnitudonya)
    const reduce = Math.abs(c.diff) - Math.abs(c.appliedDiff);
    s.shortageQty -= reduce;
    s.shortageValue = Math.round((s.shortageValue - reduce * num(c.unitCost)) * 100) / 100;
  }
  for (const s of out.values()) s.netValue = Math.round((s.surplusValue - s.shortageValue) * 100) / 100;
  return out;
}

function emptySummary() {
  return { totalItems: 0, countedItems: 0, surplusQty: 0, shortageQty: 0, surplusValue: 0, shortageValue: 0, netValue: 0 };
}

export const ITEM_INCLUDE = {
  product: { select: { id: true, name: true, sku: true, barcode: true, unit: true, category: { select: { name: true } } } },
} as const;

export type OpnameNames = { categoryName: string | null; createdByName: string | null };

/** Nama kategori & pembuat untuk sekumpulan sesi (2 query total). */
export async function loadNames(client: Client, opnames: { id: string; categoryId: string | null; createdById: string }[]) {
  const catIds = [...new Set(opnames.map((o) => o.categoryId).filter((x): x is string => !!x))];
  const userIds = [...new Set(opnames.map((o) => o.createdById))];
  const [cats, users] = await Promise.all([
    catIds.length ? client.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    userIds.length ? client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const cm = new Map(cats.map((c) => [c.id, c.name]));
  const um = new Map(users.map((u) => [u.id, u.name]));
  return new Map<string, OpnameNames>(
    opnames.map((o) => [o.id, { categoryName: o.categoryId ? cm.get(o.categoryId) ?? null : null, createdByName: um.get(o.createdById) ?? null }])
  );
}

export function serializeHeader(o: any, summary: ReturnType<typeof emptySummary>, names?: OpnameNames) {
  return {
    id: o.id,
    opnameNo: o.opnameNo,
    status: o.status,
    warehouseId: o.warehouseId,
    warehouse: o.warehouse,
    categoryId: o.categoryId,
    categoryName: names?.categoryName ?? null,
    note: o.note,
    cancelReason: o.cancelReason,
    createdById: o.createdById,
    createdByName: names?.createdByName ?? null,
    completedById: o.completedById,
    completedAt: o.completedAt,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    summary,
  };
}

export function serializeItem(i: any, currentQty: number | null) {
  return {
    id: i.id,
    productId: i.productId,
    product: i.product ? { id: i.product.id, name: i.product.name, sku: i.product.sku, barcode: i.product.barcode, unit: i.product.unit } : i.product,
    categoryName: i.product?.category?.name ?? null,
    systemQty: i.systemQty,
    countedQty: i.countedQty,
    diff: i.diff,
    unitCost: num(i.unitCost),
    diffValue: num(i.diffValue),
    currentQty,
    stockChanged: currentQty !== null && currentQty !== i.systemQty,
    stockBeforeFinalize: i.stockBeforeFinalize,
    appliedDiff: i.appliedDiff,
    countedAt: i.countedAt,
    countedById: i.countedById,
  };
}

/** Header + summary + (opsional) items. currentQty hanya untuk sesi DRAFT. */
export async function serializeOpname(client: Client, o: any, withItems: boolean) {
  const summary = (await summarize(client, [o.id])).get(o.id)!;
  const names = (await loadNames(client, [o])).get(o.id);
  const header = serializeHeader(o, summary, names);
  if (!withItems) return header;
  const items = await client.stockOpnameItem.findMany({
    where: { stockOpnameId: o.id },
    include: ITEM_INCLUDE,
    orderBy: { product: { name: "asc" } },
  });
  let stockMap: Map<string, number> | null = null;
  if (o.status === "DRAFT") {
    const stocks = await client.stock.findMany({
      where: { warehouseId: o.warehouseId, productId: { in: items.map((i) => i.productId) } },
      select: { productId: true, quantity: true },
    });
    stockMap = new Map(stocks.map((s) => [s.productId, s.quantity]));
  }
  return { ...header, items: items.map((i) => serializeItem(i, stockMap ? stockMap.get(i.productId) ?? 0 : null)) };
}

/** Kunci baris gudang (serialisasi pembuatan sesi per gudang) lalu tolak bila sudah ada DRAFT. */
export async function assertNoDraft(tx: TxClient, tenantId: string, warehouseId: string) {
  await tx.$queryRaw`SELECT id FROM warehouses WHERE id = ${warehouseId} AND tenant_id = ${tenantId} FOR UPDATE`;
  const existing = await tx.stockOpname.findFirst({
    where: { tenantId, warehouseId, status: "DRAFT" },
    select: { id: true, opnameNo: true },
  });
  if (existing) {
    throw new ConsignError(409, `Gudang ini masih punya sesi opname DRAFT (${existing.opnameNo})`, "DRAFT_EXISTS", { opnameId: existing.id, opnameNo: existing.opnameNo });
  }
}
