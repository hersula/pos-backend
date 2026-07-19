import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId") ?? undefined;
    const lowStockOnly = searchParams.get("lowStock") === "true";

    const stocks = await prisma.stock.findMany({
      where: {
        tenantId: user.tenantId,
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: { product: true, warehouse: true },
      orderBy: { product: { name: "asc" } },
    });

    let result = stocks.map((s) => ({
      id: s.id,
      quantity: s.quantity,
      product: { id: s.product.id, name: s.product.name, sku: s.product.sku, minStock: s.product.minStock, unit: s.product.unit },
      warehouse: { id: s.warehouse.id, name: s.warehouse.name },
      isLowStock: s.quantity <= s.product.minStock,
    }));

    if (lowStockOnly) {
      result = result.filter((s) => s.isLowStock);
    }

    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list stocks error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
