import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole } from "@/lib/auth";
import { adjustStock } from "@/lib/inventory";
import {
  ConsignError,
  assertStatus,
  handleConsignError,
  loadOrderOrThrow,
  lockOrder,
  serializeOrder,
  sumBaseByProduct,
} from "@/lib/consignment";

// POST — kirim barang: DRAFT -> SENT, stok pindah dari gudang toko ke gudang konsinyasi
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);

    await prisma.$transaction(async (tx) => {
      await lockOrder(tx, user.tenantId, params.id);
      const order = await loadOrderOrThrow(tx, user.tenantId, params.id);
      assertStatus(order, ["DRAFT"], "dikirim");

      const needed = sumBaseByProduct(order.items.map((i) => ({ productId: i.productId, baseQty: i.baseQtySent })));

      // Cek semua produk dulu supaya pesan error menyebut seluruh kekurangan sekaligus
      const stocks = await tx.stock.findMany({
        where: { tenantId: user.tenantId, warehouseId: order.sourceWarehouseId, productId: { in: [...needed.keys()] } },
      });
      const available = new Map(stocks.map((s) => [s.productId, s.quantity]));
      const names = new Map(order.items.map((i) => [i.productId, i.product.name]));
      const shortages = [...needed.entries()]
        .filter(([pid, req]) => (available.get(pid) ?? 0) < req)
        .map(([pid, req]) => ({ productId: pid, productName: names.get(pid), available: available.get(pid) ?? 0, required: req }));
      if (shortages.length > 0) {
        throw new ConsignError(
          400,
          `Stok tidak mencukupi untuk: ${shortages.map((s) => s.productName).join(", ")}`,
          "INSUFFICIENT_STOCK",
          shortages
        );
      }

      for (const [productId, baseQty] of needed) {
        await adjustStock(tx, {
          tenantId: user.tenantId,
          productId,
          warehouseId: order.sourceWarehouseId,
          type: "TRANSFER",
          qty: baseQty,
          direction: -1,
          referenceType: "CONSIGNMENT_SEND",
          referenceId: order.id,
          note: `Kirim konsinyasi ${order.consignmentNo}`,
          createdBy: user.userId,
        });
        await adjustStock(tx, {
          tenantId: user.tenantId,
          productId,
          warehouseId: order.consignWarehouseId,
          type: "TRANSFER",
          qty: baseQty,
          direction: 1,
          referenceType: "CONSIGNMENT_SEND",
          referenceId: order.id,
          note: `Kirim konsinyasi ${order.consignmentNo}`,
          createdBy: user.userId,
        });
      }

      await tx.consignmentOrder.update({ where: { id: order.id }, data: { status: "SENT", sentAt: new Date() } });
    }, { timeout: 20000, maxWait: 20000 });

    const order = await loadOrderOrThrow(prisma, user.tenantId, params.id);
    return NextResponse.json({ message: "Barang konsinyasi dikirim", data: await serializeOrder(order, { detail: true }) });
  } catch (err) {
    return handleConsignError(err, "send consignment error");
  }
}
