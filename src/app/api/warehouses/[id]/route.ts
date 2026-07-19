import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

const updateSchema = z.object({ name: z.string().min(2) });

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);

    const warehouse = await prisma.warehouse.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!warehouse) return NextResponse.json({ message: "Gudang tidak ditemukan" }, { status: 404 });

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ message: "Data tidak valid" }, { status: 400 });

    const updated = await prisma.warehouse.update({ where: { id: params.id }, data: { name: parsed.data.name } });
    return NextResponse.json({ message: "Gudang berhasil diperbarui", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("update warehouse error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER"]);

    const warehouse = await prisma.warehouse.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!warehouse) return NextResponse.json({ message: "Gudang tidak ditemukan" }, { status: 404 });

    const stockCount = await prisma.stock.count({ where: { warehouseId: params.id, quantity: { gt: 0 } } });
    if (stockCount > 0) {
      return NextResponse.json({ message: "Tidak bisa hapus gudang yang masih memiliki stok" }, { status: 409 });
    }

    await prisma.warehouse.delete({ where: { id: params.id } });
    return NextResponse.json({ message: "Gudang berhasil dihapus" });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("delete warehouse error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
