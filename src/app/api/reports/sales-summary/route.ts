import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const { searchParams } = new URL(req.url);

    const dateFrom = searchParams.get("dateFrom"); // YYYY-MM-DD, default: hari ini
    const dateTo = searchParams.get("dateTo");
    const warehouseId = searchParams.get("warehouseId") ?? undefined;
    const cashierId = searchParams.get("cashierId") ?? undefined;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const gte = dateFrom ? new Date(dateFrom) : startOfToday;
    const lt = dateTo
      ? new Date(new Date(dateTo).getTime() + 24 * 60 * 60 * 1000)
      : new Date(gte.getTime() + 24 * 60 * 60 * 1000);

    const sales = await prisma.sale.findMany({
      where: {
        tenantId: user.tenantId,
        createdAt: { gte, lt },
        status: { in: ["PAID", "PARTIAL"] },
        ...(warehouseId ? { warehouseId } : {}),
        ...(cashierId ? { cashierId } : {}),
      },
      include: { payments: true, items: { include: { product: true } } },
    });

    const totalTransactions = sales.length;
    const totalGrossSales = sales.reduce((sum, s) => sum + Number(s.subtotal), 0);
    const totalDiscount = sales.reduce((sum, s) => sum + Number(s.discountAmount), 0);
    const totalTax = sales.reduce((sum, s) => sum + Number(s.taxAmount), 0);
    const totalNetSales = sales.reduce((sum, s) => sum + Number(s.grandTotal), 0);
    const totalOutstanding = sales
      .filter((s) => s.status === "PARTIAL")
      .reduce((sum, s) => sum + (Number(s.grandTotal) - Number(s.paidTotal)), 0);

    // Total jumlah barang (qty) yang terjual, digabung dari semua item di semua transaksi periode ini
    const totalItemsSold = sales.reduce(
      (sum, s) => sum + s.items.reduce((itemSum, item) => itemSum + item.qty, 0),
      0
    );

    // Rekap produk terlaris berdasarkan qty terjual (5 teratas) — data sudah ada di `items`, murah untuk dihitung sekalian
    const productStats = new Map<string, { productName: string; qtySold: number; revenue: number }>();
    for (const sale of sales) {
      for (const item of sale.items) {
        const existing = productStats.get(item.productId) ?? { productName: item.product.name, qtySold: 0, revenue: 0 };
        existing.qtySold += item.qty;
        existing.revenue += Number(item.subtotal);
        productStats.set(item.productId, existing);
      }
    }
    const topProducts = [...productStats.entries()]
      .map(([productId, stat]) => ({ productId, ...stat, revenue: round2(stat.revenue) }))
      .sort((a, b) => b.qtySold - a.qtySold)
      .slice(0, 5);

    // Rekap per metode pembayaran (untuk cocokkan uang fisik/EDC/QRIS saat tutup kasir)
    const byMethod: Record<string, number> = {};
    for (const sale of sales) {
      for (const payment of sale.payments) {
        byMethod[payment.method] = (byMethod[payment.method] ?? 0) + Number(payment.amount);
      }
    }

    return NextResponse.json({
      period: { from: gte.toISOString(), to: lt.toISOString() },
      totalTransactions,
      totalItemsSold,
      totalGrossSales: round2(totalGrossSales),
      totalDiscount: round2(totalDiscount),
      totalTax: round2(totalTax),
      totalNetSales: round2(totalNetSales),
      totalOutstanding: round2(totalOutstanding),
      byPaymentMethod: byMethod,
      topProducts,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("sales summary error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
