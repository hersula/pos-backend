import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest } from "@/lib/auth";
import { handleConsignError } from "@/lib/consignment";

// GET — sisa stok fisik di gudang konsinyasi (apa yang sekarang ada di outlet). Semua role tenant.
export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const customerId = new URL(req.url).searchParams.get("customerId") ?? undefined;

    const warehouses = await prisma.warehouse.findMany({
      where: { tenantId: user.tenantId, type: "CONSIGNMENT", ...(customerId ? { customerId } : {}) },
      include: {
        customer: { select: { id: true, name: true } },
        stocks: { where: { quantity: { gt: 0 } }, include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
      orderBy: { name: "asc" },
    });

    const data = warehouses
      .filter((w) => w.stocks.length > 0)
      .map((w) => ({
        customerId: w.customerId,
        customerName: w.customer?.name ?? null,
        warehouseId: w.id,
        warehouseName: w.name,
        products: w.stocks
          .map((s) => ({ productId: s.product.id, name: s.product.name, sku: s.product.sku, unit: s.product.unit, quantity: s.quantity }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));

    return NextResponse.json({ data });
  } catch (err) {
    return handleConsignError(err, "outlet stock error");
  }
}
