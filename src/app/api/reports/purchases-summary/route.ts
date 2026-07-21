import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG", "AKUNTAN"]);

    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const gte = dateFrom ? new Date(dateFrom) : defaultFrom;
    const lt = dateTo ? new Date(new Date(dateTo).getTime() + 24 * 60 * 60 * 1000) : new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const orders = await prisma.purchaseOrder.findMany({
      where: {
        tenantId: user.tenantId,
        status: "RECEIVED",
        createdAt: { gte, lt },
      },
      include: { supplier: true },
    });

    const totalPurchases = orders.reduce((sum, po) => sum + Number(po.total), 0);
    const totalTransactions = orders.length;

    const byPaymentMethod: Record<string, number> = {};
    for (const po of orders) {
      byPaymentMethod[po.paymentMethod] = (byPaymentMethod[po.paymentMethod] ?? 0) + Number(po.total);
    }

    // Hutang usaha (CREDIT) belum lunas — status saldo saat ini, bukan dibatasi periode filter,
    // karena ini snapshot posisi hutang berjalan, bukan arus kas dalam periode
    const unpaidCreditOrders = await prisma.purchaseOrder.findMany({
      where: { tenantId: user.tenantId, status: "RECEIVED", paymentMethod: "CREDIT", paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
      include: { supplier: true },
    });

    const totalOutstandingDebt = unpaidCreditOrders.reduce((sum, po) => sum + (Number(po.total) - Number(po.paidAmount)), 0);

    return NextResponse.json({
      period: { from: gte.toISOString(), to: lt.toISOString() },
      totalTransactions,
      totalPurchases: round2(totalPurchases),
      byPaymentMethod,
      totalOutstandingDebt: round2(totalOutstandingDebt),
      outstandingDebts: unpaidCreditOrders.map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        supplierName: po.supplier?.name ?? null,
        total: Number(po.total),
        paidAmount: Number(po.paidAmount),
        outstanding: round2(Number(po.total) - Number(po.paidAmount)),
        createdAt: po.createdAt,
      })),
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("purchases summary error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
