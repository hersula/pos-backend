import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

const updateSchema = z.object({
  name: z.string().min(2),
});

async function assertOwnedByTenant(id: string, tenantId: string) {
  const priceLevel = await prisma.priceLevel.findFirst({ where: { id, tenantId } });
  if (!priceLevel) throw new AuthError("Level harga tidak ditemukan", 404);
  return priceLevel;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);
    await assertOwnedByTenant(params.id, user.tenantId);

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid" }, { status: 400 });
    }

    const updated = await prisma.priceLevel.update({
      where: { id: params.id },
      data: { name: parsed.data.name },
    });

    return NextResponse.json({ message: "Level harga berhasil diperbarui", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("update price level error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

// Hapus level harga langsung cascade-delete override harga produk yang pakai level ini
// (ProductPrice.onDelete: Cascade) -- aman krn transaksi lama sudah snapshot unitPrice-nya
// sendiri, tidak pernah merujuk balik ke PriceLevel.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);
    await assertOwnedByTenant(params.id, user.tenantId);

    await prisma.priceLevel.delete({ where: { id: params.id } });
    return NextResponse.json({ message: "Level harga berhasil dihapus" });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("delete price level error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
