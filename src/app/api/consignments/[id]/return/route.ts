import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole } from "@/lib/auth";
import { adjustStock } from "@/lib/inventory";
import {
  ConsignError,
  assertStatus,
  deriveStatus,
  handleConsignError,
  lineSchema,
  loadOrderOrThrow,
  lockOrder,
  parseBody,
  serializeOrder,
  sumBaseByProduct,
} from "@/lib/consignment";

const bodySchema = z.object({
  lines: z.array(lineSchema.pick({ consignmentItemId: true, qty: true, useBaseUnit: true })).min(1).max(200),
  note: z.string().max(1000).optional(),
});

// POST — retur sisa barang dari outlet ke gudang asal
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);
    const body = await parseBody(req, bodySchema);

    await prisma.$transaction(async (tx) => {
      await lockOrder(tx, user.tenantId, params.id);
      const order = await loadOrderOrThrow(tx, user.tenantId, params.id);
      assertStatus(order, ["SENT", "PARTIALLY_SETTLED"], "diretur");

      const itemMap = new Map(order.items.map((i) => [i.id, i]));
      const seen = new Set<string>();
      const resolved: { item: (typeof order.items)[number]; baseQty: number }[] = [];
      for (const line of body.lines) {
        const item = itemMap.get(line.consignmentItemId);
        if (!item) throw new ConsignError(404, "Item konsinyasi tidak ditemukan pada dokumen ini");
        if (seen.has(item.id)) throw new ConsignError(400, "Item yang sama tidak boleh muncul dua kali", "DUPLICATE_ITEM");
        seen.add(item.id);

        const baseQty = line.useBaseUnit ? line.qty : line.qty * item.conversionQtySnapshot;
        const remaining = item.baseQtySent - item.baseQtySold - item.baseQtyReturned;
        if (baseQty > remaining) {
          throw new ConsignError(400, `Jumlah retur "${item.product.name}" melebihi sisa di outlet (${remaining})`, "EXCEEDS_REMAINING", [
            { consignmentItemId: item.id, remaining, requested: baseQty },
          ]);
        }
        resolved.push({ item, baseQty });
      }

      for (const [productId, baseQty] of sumBaseByProduct(resolved.map((r) => ({ productId: r.item.productId, baseQty: r.baseQty })))) {
        // Konversi sudah diterapkan di baseQty (qty x conversionQtySnapshot) — stok selalu satuan dasar
        await adjustStock(tx, {
          tenantId: user.tenantId,
          productId,
          warehouseId: order.consignWarehouseId,
          type: "TRANSFER",
          qty: baseQty,
          direction: -1,
          referenceType: "CONSIGNMENT_RETURN",
          referenceId: order.id,
          note: `Retur konsinyasi ${order.consignmentNo}`,
          createdBy: user.userId,
        });
        await adjustStock(tx, {
          tenantId: user.tenantId,
          productId,
          warehouseId: order.sourceWarehouseId,
          type: "TRANSFER",
          qty: baseQty,
          direction: 1,
          referenceType: "CONSIGNMENT_RETURN",
          referenceId: order.id,
          note: `Retur konsinyasi ${order.consignmentNo}`,
          createdBy: user.userId,
        });
      }

      for (const r of resolved) {
        await tx.consignmentItem.update({ where: { id: r.item.id }, data: { baseQtyReturned: { increment: r.baseQty } } });
      }
      await tx.consignmentSettlement.create({
        data: {
          tenantId: user.tenantId,
          consignmentOrderId: order.id,
          type: "RETURN",
          note: body.note,
          createdById: user.userId,
          lines: resolved.map((r) => ({ consignmentItemId: r.item.id, baseQty: r.baseQty })),
        },
      });

      const updatedItems = order.items.map((i) => {
        const r = resolved.find((x) => x.item.id === i.id);
        return r ? { ...i, baseQtyReturned: i.baseQtyReturned + r.baseQty } : i;
      });
      await tx.consignmentOrder.update({ where: { id: order.id }, data: { status: deriveStatus(updatedItems) } });
    }, { timeout: 20000, maxWait: 20000 });

    const order = await loadOrderOrThrow(prisma, user.tenantId, params.id);
    return NextResponse.json({ message: "Retur konsinyasi dicatat", data: await serializeOrder(order, { detail: true }) });
  } catch (err) {
    return handleConsignError(err, "return consignment error");
  }
}
