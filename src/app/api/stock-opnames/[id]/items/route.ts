import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole } from "@/lib/auth";
import {
  ITEM_INCLUDE,
  OpnameError,
  assertDraft,
  countSchema,
  handleOpnameError,
  loadOpnameOrThrow,
  lockOpname,
  parseBody,
  serializeItem,
  serializeOpname,
} from "@/lib/stock-opname";

// PATCH — simpan hitungan fisik (batch), hanya DRAFT. OWNER, MANAGER, GUDANG, KASIR.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG", "KASIR"]);
    const body = await parseBody(req, countSchema);

    const changedIds = await prisma.$transaction(
      async (tx) => {
        await lockOpname(tx, user.tenantId, params.id);
        const opname = await loadOpnameOrThrow(tx, user.tenantId, params.id);
        assertDraft(opname, "diubah hitungannya");

        const existing = await tx.stockOpnameItem.findMany({
          where: { stockOpnameId: opname.id, id: { in: body.items.map((i) => i.itemId) } },
        });
        if (existing.length !== body.items.length) throw new OpnameError(404, "Item opname tidak ditemukan");
        const byId = new Map(existing.map((e) => [e.id, e]));

        const now = new Date();
        for (const line of body.items) {
          const it = byId.get(line.itemId)!;
          const counted = line.countedQty;
          const diff = counted === null ? 0 : counted - it.systemQty;
          await tx.stockOpnameItem.update({
            where: { id: it.id },
            data: {
              countedQty: counted,
              diff,
              diffValue: Math.round(diff * Number(it.unitCost) * 100) / 100,
              countedAt: counted === null ? null : now,
              countedById: counted === null ? null : user.userId,
            },
          });
        }
        return body.items.map((i) => i.itemId);
      },
      { timeout: 30000, maxWait: 20000 }
    );

    const opname = await loadOpnameOrThrow(prisma, user.tenantId, params.id);
    const header = await serializeOpname(prisma, opname, false);
    const items = await prisma.stockOpnameItem.findMany({ where: { id: { in: changedIds } }, include: ITEM_INCLUDE });
    const stocks = await prisma.stock.findMany({
      where: { warehouseId: opname.warehouseId, productId: { in: items.map((i) => i.productId) } },
      select: { productId: true, quantity: true },
    });
    const sm = new Map(stocks.map((s) => [s.productId, s.quantity]));
    return NextResponse.json({
      message: "Hitungan disimpan",
      data: header,
      items: items.map((i) => serializeItem(i, sm.get(i.productId) ?? 0)),
    });
  } catch (err) {
    return handleOpnameError(err, "update stock opname counts error");
  }
}
