import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);

    const sale = await prisma.sale.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        items: { include: { product: true } },
        payments: true,
        cashier: { select: { id: true, name: true } },
        customer: true,
        warehouse: true,
        tenant: { select: { businessName: true, address: true, phone: true } },
      },
    });

    if (!sale) return NextResponse.json({ message: "Transaksi tidak ditemukan" }, { status: 404 });

    return NextResponse.json({ data: sale });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("get sale error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
