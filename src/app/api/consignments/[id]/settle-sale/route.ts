import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole } from "@/lib/auth";
import { calculateSaleTotals } from "@/lib/sales";
import { createSaleInTx, freeLimitBlock, type ResolvedSaleItem } from "@/lib/sale-service";
import {
  ConsignError,
  assertStatus,
  deriveStatus,
  handleConsignError,
  lineSchema,
  loadOrderOrThrow,
  lockOrder,
  parseBody,
  round2,
  serializeOrder,
} from "@/lib/consignment";

const bodySchema = z.object({
  lines: z.array(lineSchema).min(1, "Minimal 1 baris").max(200),
  discountType: z.enum(["PERCENT", "NOMINAL"]).default("NOMINAL"),
  discountValue: z.number().min(0).default(0),
  taxPercent: z.number().min(0).max(100).default(11),
  payments: z
    .array(
      z.object({
        method: z.enum(["CASH", "DEBIT", "CREDIT", "QRIS", "TRANSFER", "EWALLET"]),
        amount: z.number().positive(),
        referenceNo: z.string().max(100).optional(),
      })
    )
    .max(10)
    .default([]),
  note: z.string().max(1000).optional(),
});

// POST — catat barang terjual di outlet: membuat Sale biasa (piutang bila tanpa pembayaran)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);

    const limitBlock = await freeLimitBlock(user.tenantId);
    if (limitBlock) return NextResponse.json(limitBlock, { status: 403 });

    const body = await parseBody(req, bodySchema);

    const saleId = await prisma.$transaction(async (tx) => {
      await lockOrder(tx, user.tenantId, params.id);
      const order = await loadOrderOrThrow(tx, user.tenantId, params.id);
      assertStatus(order, ["SENT", "PARTIALLY_SETTLED"], "dicatat terjual");

      const itemMap = new Map(order.items.map((i) => [i.id, i]));
      const seen = new Set<string>();
      const saleItems: ResolvedSaleItem[] = [];
      const settleLines: { consignmentItemId: string; baseQty: number }[] = [];

      for (const line of body.lines) {
        const item = itemMap.get(line.consignmentItemId);
        if (!item) throw new ConsignError(404, "Item konsinyasi tidak ditemukan pada dokumen ini");
        if (seen.has(item.id)) throw new ConsignError(400, "Item yang sama tidak boleh muncul dua kali", "DUPLICATE_ITEM");
        seen.add(item.id);

        const conv = item.conversionQtySnapshot;
        const baseQty = line.useBaseUnit ? line.qty : line.qty * conv;
        const remaining = item.baseQtySent - item.baseQtySold - item.baseQtyReturned;
        if (baseQty > remaining) {
          throw new ConsignError(400, `Jumlah terjual "${item.product.name}" melebihi sisa di outlet (${remaining})`, "EXCEEDS_REMAINING", [
            { consignmentItemId: item.id, remaining, requested: baseQty },
          ]);
        }

        const agreed = Number(item.agreedUnitPrice);
        if (line.useBaseUnit) {
          saleItems.push({
            productId: item.productId,
            productUnitId: null,
            unitLabel: null,
            conversionQty: 1,
            qty: line.qty,
            unitPrice: line.unitPrice ?? round2(agreed / conv),
          });
        } else {
          saleItems.push({
            productId: item.productId,
            productUnitId: item.productUnitId,
            unitLabel: item.unitLabel,
            conversionQty: conv,
            qty: line.qty,
            unitPrice: line.unitPrice ?? agreed,
          });
        }
        settleLines.push({ consignmentItemId: item.id, baseQty });
      }

      const products = await tx.product.findMany({
        where: { id: { in: [...new Set(saleItems.map((s) => s.productId))] }, tenantId: user.tenantId },
        select: { id: true, costPrice: true },
      });
      const costPriceByProduct = new Map(products.map((p) => [p.id, Number(p.costPrice)]));

      const totals = calculateSaleTotals({
        items: saleItems,
        discountType: body.discountType,
        discountValue: body.discountValue,
        taxPercent: body.taxPercent,
      });

      // Penjualan dari gudang konsinyasi outlet (stok berkurang di sana), customer = outlet
      const sale = await createSaleInTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        warehouseId: order.consignWarehouseId,
        customerId: order.customerId,
        items: saleItems,
        costPriceByProduct,
        totals,
        discountType: body.discountType,
        discountValue: body.discountValue,
        taxPercent: body.taxPercent,
        payments: body.payments,
        note: body.note ?? `Konsinyasi ${order.consignmentNo}`,
        consignmentOrderId: order.id,
      });

      for (const l of settleLines) {
        await tx.consignmentItem.update({ where: { id: l.consignmentItemId }, data: { baseQtySold: { increment: l.baseQty } } });
      }
      await tx.consignmentSettlement.create({
        data: {
          tenantId: user.tenantId,
          consignmentOrderId: order.id,
          type: "SALE",
          saleId: sale.id,
          note: body.note,
          createdById: user.userId,
          lines: settleLines,
        },
      });

      const updatedItems = order.items.map((i) => {
        const l = settleLines.find((x) => x.consignmentItemId === i.id);
        return l ? { ...i, baseQtySold: i.baseQtySold + l.baseQty } : i;
      });
      await tx.consignmentOrder.update({ where: { id: order.id }, data: { status: deriveStatus(updatedItems) } });

      return sale.id;
    }, { timeout: 20000, maxWait: 20000 });

    const [order, sale] = await Promise.all([
      loadOrderOrThrow(prisma, user.tenantId, params.id),
      prisma.sale.findFirstOrThrow({
        where: { id: saleId, tenantId: user.tenantId },
        include: {
          items: { include: { product: true } },
          payments: true,
          cashier: { select: { id: true, name: true } },
          customer: true,
          warehouse: true,
          tenant: { select: { businessName: true, address: true, phone: true } },
        },
      }),
    ]);

    return NextResponse.json(
      { message: "Penjualan konsinyasi berhasil dicatat", data: { consignment: await serializeOrder(order, { detail: true }), sale } },
      { status: 201 }
    );
  } catch (err) {
    return handleConsignError(err, "settle consignment sale error");
  }
}
