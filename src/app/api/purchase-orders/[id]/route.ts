import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: { supplier: true, warehouse: true, items: { include: { product: true } } },
    });
    if (!po) return NextResponse.json({ message: "Purchase order tidak ditemukan" }, { status: 404 });

    return NextResponse.json({ data: po });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("get purchase order error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
