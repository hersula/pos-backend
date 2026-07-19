import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG"]);

    const existing = await prisma.supplier.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!existing) return NextResponse.json({ message: "Supplier tidak ditemukan" }, { status: 404 });

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ message: "Data tidak valid" }, { status: 400 });

    const updated = await prisma.supplier.update({ where: { id: params.id }, data: parsed.data });
    return NextResponse.json({ message: "Supplier berhasil diperbarui", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("update supplier error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);

    const existing = await prisma.supplier.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!existing) return NextResponse.json({ message: "Supplier tidak ditemukan" }, { status: 404 });

    const poCount = await prisma.purchaseOrder.count({ where: { supplierId: params.id } });
    if (poCount > 0) {
      return NextResponse.json({ message: "Tidak bisa hapus supplier yang sudah punya riwayat pembelian" }, { status: 409 });
    }

    await prisma.supplier.delete({ where: { id: params.id } });
    return NextResponse.json({ message: "Supplier berhasil dihapus" });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("delete supplier error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
