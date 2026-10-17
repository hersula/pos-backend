import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole } from "@/lib/auth";
import { adjustStock } from "@/lib/inventory";
import {
  ConsignError,
  assertStatus,
  handleConsignError,
  loadOrderOrThrow,
  lockOrder,
  parseBody,
  serializeOrder,
  sumBaseByProduct,
} from "@/lib/consignment";

const bodySchema = z.object({ reason: z.string().min(3, "Alasan pembatalan wajib diisi").max(500) });

// POST — batalkan: DRAFT, atau SENT yang belum ada terjual/retur (stok dikembalikan penuh)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);
    const body = await parseBody(req, bodySchema);

    await prisma.$transaction(async (tx) => {
      await lockOrder(tx, user.tenantId, params.id);
      const order = await loadOrderOrThrow(tx, user.tenantId, params.id);
      assertStatus(order, ["DRAFT", "SENT"], "dibatalkan (sudah ada penjualan/retur, atau sudah selesai/dibatalkan)");

      if (order.status === "SENT") {
        if (order.items.some((i) => i.baseQtySold > 0 || i.baseQtyReturned > 0)) {
          throw new ConsignError(409, "Sudah ada barang terjual/diretur. Gunakan retur, atau batalkan penjualannya dulu.", "INVALID_STATUS");
        }
        const needed = sumBaseByProduct(order.items.map((i) => ({ productId: i.productId, baseQty: i.baseQtySent })));
        for (const [productId, baseQty] of needed) {
          await adjustStock(tx, {
            tenantId: user.tenantId,
            productId,
            warehouseId: order.consignWarehouseId,
            type: "TRANSFER",
            qty: baseQty,
            direction: -1,
            referenceType: "CONSIGNMENT_CANCEL",
            referenceId: order.id,
            note: `Batal konsinyasi ${order.consignmentNo}: ${body.reason}`,
            createdBy: user.userId,
          });
          await adjustStock(tx, {
            tenantId: user.tenantId,
            productId,
            warehouseId: order.sourceWarehouseId,
            type: "TRANSFER",
            qty: baseQty,
            direction: 1,
            referenceType: "CONSIGNMENT_CANCEL",
            referenceId: order.id,
            note: `Batal konsinyasi ${order.consignmentNo}: ${body.reason}`,
            createdBy: user.userId,
          });
        }
      }

      await tx.consignmentOrder.update({ where: { id: order.id }, data: { status: "CANCELLED", cancelReason: body.reason } });
    }, { timeout: 20000, maxWait: 20000 });

    const order = await loadOrderOrThrow(prisma, user.tenantId, params.id);
    return NextResponse.json({ message: "Konsinyasi dibatalkan", data: await serializeOrder(order, { detail: true }) });
  } catch (err) {
    return handleConsignError(err, "cancel consignment error");
  }
}
