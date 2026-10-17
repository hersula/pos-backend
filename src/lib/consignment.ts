import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthError } from "@/lib/auth";
import { StockInsufficientError } from "@/lib/inventory";

type TxClient = Prisma.TransactionClient;

export const MAX_BASE_QTY = 2_000_000_000;

// ---------- Error domain ----------
export class ConsignError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function handleConsignError(err: unknown, tag: string) {
  if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
  if (err instanceof ConsignError) {
    return NextResponse.json(
      { message: err.message, ...(err.code ? { code: err.code } : {}), ...(err.details ? { details: err.details } : {}) },
      { status: err.status }
    );
  }
  if (err instanceof StockInsufficientError) {
    return NextResponse.json({ message: `Stok tidak mencukupi: ${err.message}`, code: "INSUFFICIENT_STOCK" }, { status: 400 });
  }
  console.error(`${tag}:`, err);
  return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
}

/** Baca & validasi body JSON; body rusak = 400 (bukan 500). */
export async function parseBody<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ConsignError(400, "Body request harus berupa JSON yang valid");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ConsignError(400, "Data tidak valid", "VALIDATION_ERROR", parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

// ---------- Schema bersama ----------
export const orderItemSchema = z.object({
  productId: z.string().min(1),
  productUnitId: z.string().min(1).optional(),
  qty: z.number().int().min(1).max(1_000_000),
  agreedUnitPrice: z.number().min(0).max(1_000_000_000_000).optional(),
});

export const orderBodySchema = z.object({
  customerId: z.string().min(1),
  sourceWarehouseId: z.string().min(1),
  dueDate: z
    .string()
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "Tanggal tidak valid")
    .optional(),
  note: z.string().max(1000).optional(),
  items: z.array(orderItemSchema).min(1, "Minimal 1 item").max(200),
});

export const lineSchema = z.object({
  consignmentItemId: z.string().min(1),
  qty: z.number().int().min(1).max(MAX_BASE_QTY),
  useBaseUnit: z.boolean().optional(),
  unitPrice: z.number().min(0).max(1_000_000_000_000).optional(),
});

// ---------- Query / serialisasi ----------
export const ORDER_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true } },
  sourceWarehouse: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } }, orderBy: { id: "asc" } },
  settlements: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.ConsignmentOrderInclude;

type OrderFull = Prisma.ConsignmentOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type OrderForSummary = Pick<OrderFull, "items"> & Partial<OrderFull>;

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function summarize(items: { baseQtySent: number; baseQtySold: number; baseQtyReturned: number; conversionQtySnapshot: number; agreedUnitPrice: Prisma.Decimal | number }[]) {
  let sent = 0, sold = 0, returned = 0, remaining = 0;
  for (const it of items) {
    const perBase = Number(it.agreedUnitPrice) / it.conversionQtySnapshot;
    sent += it.baseQtySent * perBase;
    sold += it.baseQtySold * perBase;
    returned += it.baseQtyReturned * perBase;
    remaining += (it.baseQtySent - it.baseQtySold - it.baseQtyReturned) * perBase;
  }
  return {
    itemCount: items.length,
    totalValueSent: round2(sent),
    totalValueSold: round2(sold),
    totalValueReturned: round2(returned),
    totalValueRemaining: round2(remaining),
  };
}

export async function serializeOrder(order: OrderForSummary & Record<string, any>, opts: { detail: boolean }) {
  const { items, settlements, ...rest } = order;
  const base = {
    ...rest,
    summary: summarize(items),
  };
  if (!opts.detail) return base;

  const saleIds = (settlements ?? []).map((s: any) => s.saleId).filter(Boolean) as string[];
  const sales = saleIds.length
    ? await prisma.sale.findMany({ where: { id: { in: saleIds }, tenantId: order.tenantId }, select: { id: true, invoiceNo: true } })
    : [];
  const invoiceBySale = new Map(sales.map((s) => [s.id, s.invoiceNo]));

  return {
    ...base,
    items: items.map((it: any) => ({
      id: it.id,
      productId: it.productId,
      product: it.product,
      productUnitId: it.productUnitId,
      unitLabel: it.unitLabel,
      conversionQty: it.conversionQtySnapshot,
      qtySent: it.qtySent,
      baseQtySent: it.baseQtySent,
      baseQtySold: it.baseQtySold,
      baseQtyReturned: it.baseQtyReturned,
      baseQtyRemaining: it.baseQtySent - it.baseQtySold - it.baseQtyReturned,
      agreedUnitPrice: Number(it.agreedUnitPrice),
    })),
    settlements: (settlements ?? []).map((s: any) => ({
      id: s.id,
      type: s.type,
      saleId: s.saleId,
      invoiceNo: s.saleId ? invoiceBySale.get(s.saleId) ?? null : null,
      note: s.note,
      voidedAt: s.voidedAt,
      createdById: s.createdById,
      createdAt: s.createdAt,
      lines: s.lines,
    })),
  };
}

export async function loadOrder(client: TxClient | typeof prisma, tenantId: string, id: string) {
  return client.consignmentOrder.findFirst({ where: { id, tenantId }, include: ORDER_INCLUDE });
}

export async function loadOrderOrThrow(client: TxClient | typeof prisma, tenantId: string, id: string) {
  const order = await loadOrder(client, tenantId, id);
  if (!order) throw new ConsignError(404, "Konsinyasi tidak ditemukan");
  return order;
}

/** Kunci baris dokumen (SELECT ... FOR UPDATE) supaya mutasi paralel pada dokumen yang sama berurutan. */
export async function lockOrder(tx: TxClient, tenantId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM consignment_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`;
  if (rows.length === 0) throw new ConsignError(404, "Konsinyasi tidak ditemukan");
}

export function deriveStatus(items: { baseQtySent: number; baseQtySold: number; baseQtyReturned: number }[]) {
  const allDone = items.length > 0 && items.every((i) => i.baseQtySold + i.baseQtyReturned >= i.baseQtySent);
  if (allDone) return "SETTLED" as const;
  if (items.some((i) => i.baseQtySold + i.baseQtyReturned > 0)) return "PARTIALLY_SETTLED" as const;
  return "SENT" as const;
}

export function assertStatus(order: { status: string }, allowed: string[], label: string) {
  if (!allowed.includes(order.status)) {
    throw new ConsignError(409, `Konsinyasi berstatus ${order.status}, tidak bisa ${label}`, "INVALID_STATUS");
  }
}

// ---------- Resolusi item dokumen ----------
export async function resolveOrderItems(tenantId: string, items: z.infer<typeof orderItemSchema>[]) {
  const seen = new Set<string>();
  for (const it of items) {
    const key = `${it.productId}|${it.productUnitId ?? ""}`;
    if (seen.has(key)) throw new ConsignError(400, "Kombinasi produk dan satuan yang sama tidak boleh muncul dua kali", "DUPLICATE_ITEM");
    seen.add(key);
  }

  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.productId))] }, tenantId },
    include: { units: true },
  });
  const map = new Map(products.map((p) => [p.id, p]));

  return items.map((it) => {
    const product = map.get(it.productId);
    if (!product) throw new ConsignError(404, `Produk dengan id ${it.productId} tidak ditemukan`);
    const unit = it.productUnitId ? product.units.find((u) => u.id === it.productUnitId && u.isActive) : undefined;
    if (it.productUnitId && !unit) {
      throw new ConsignError(404, `Satuan yang dipilih untuk produk "${product.name}" tidak ditemukan`);
    }
    const conversionQty = unit?.conversionQty ?? 1;
    const baseQty = it.qty * conversionQty;
    if (baseQty > MAX_BASE_QTY) throw new ConsignError(400, `Jumlah untuk produk "${product.name}" terlalu besar`);
    return {
      productId: product.id,
      productUnitId: unit?.id ?? null,
      unitLabel: unit?.name ?? null,
      conversionQtySnapshot: conversionQty,
      qtySent: it.qty,
      baseQtySent: baseQty,
      agreedUnitPrice: it.agreedUnitPrice ?? Number(unit?.sellPrice ?? product.sellPrice),
    };
  });
}

export async function ensureConsignWarehouse(tenantId: string, customer: { id: string; name: string | null }) {
  const find = () => prisma.warehouse.findFirst({ where: { tenantId, customerId: customer.id, type: "CONSIGNMENT" } });
  const existing = await find();
  if (existing) return existing;
  try {
    return await prisma.warehouse.create({
      data: { tenantId, customerId: customer.id, type: "CONSIGNMENT", name: `Konsinyasi - ${customer.name ?? customer.id}`.slice(0, 190) },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await find();
      if (again) return again;
    }
    throw err;
  }
}

export async function generateConsignmentNo(tx: TxClient, tenantId: string) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const prefix = `KNS-${dateStr}-`;
  const last = await tx.consignmentOrder.findFirst({
    where: { tenantId, consignmentNo: { startsWith: prefix } },
    orderBy: { consignmentNo: "desc" },
    select: { consignmentNo: true },
  });
  const lastSeq = last ? Number(last.consignmentNo.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, "0")}`;
}

/** Jumlah base qty per produk dari daftar item (satu produk bisa muncul di beberapa satuan). */
export function sumBaseByProduct(items: { productId: string; baseQty: number }[]) {
  const m = new Map<string, number>();
  for (const it of items) m.set(it.productId, (m.get(it.productId) ?? 0) + it.baseQty);
  return m;
}

/**
 * Dipanggil saat Sale hasil settle konsinyasi dibatalkan: kurangi baseQtySold sesuai baris settlement,
 * tandai settlement void, dan hitung ulang status dokumen. Stok sudah dikembalikan oleh cancel sale
 * (ke gudang konsinyasi, karena Sale.warehouseId = gudang konsinyasi).
 */
export async function voidConsignmentSaleInTx(tx: TxClient, tenantId: string, saleId: string) {
  const settlement = await tx.consignmentSettlement.findFirst({ where: { saleId, tenantId, voidedAt: null } });
  if (!settlement) return;

  await lockOrder(tx, tenantId, settlement.consignmentOrderId);

  const lines = settlement.lines as { consignmentItemId: string; baseQty: number }[];
  for (const line of lines) {
    await tx.consignmentItem.updateMany({
      where: { id: line.consignmentItemId, consignmentOrderId: settlement.consignmentOrderId },
      data: { baseQtySold: { decrement: line.baseQty } },
    });
  }
  await tx.consignmentSettlement.update({ where: { id: settlement.id }, data: { voidedAt: new Date() } });

  const order = await tx.consignmentOrder.findFirst({
    where: { id: settlement.consignmentOrderId, tenantId },
    include: { items: true },
  });
  if (order && order.status !== "CANCELLED" && order.status !== "DRAFT") {
    await tx.consignmentOrder.update({ where: { id: order.id }, data: { status: deriveStatus(order.items) } });
  }
}
