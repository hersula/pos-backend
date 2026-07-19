import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

const updateSchema = z.object({
  name: z.string().min(2),
});

async function assertOwnedByTenant(id: string, tenantId: string) {
  const category = await prisma.category.findFirst({ where: { id, tenantId } });
  if (!category) throw new AuthError("Kategori tidak ditemukan", 404);
  return category;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG"]);
    await assertOwnedByTenant(params.id, user.tenantId);

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid" }, { status: 400 });
    }

    const updated = await prisma.category.update({
      where: { id: params.id },
      data: { name: parsed.data.name },
    });

    return NextResponse.json({ message: "Kategori berhasil diperbarui", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("update category error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);
    await assertOwnedByTenant(params.id, user.tenantId);

    const productCount = await prisma.product.count({ where: { categoryId: params.id } });
    if (productCount > 0) {
      return NextResponse.json(
        { message: `Tidak bisa hapus kategori karena masih dipakai oleh ${productCount} produk` },
        { status: 409 }
      );
    }

    await prisma.category.delete({ where: { id: params.id } });
    return NextResponse.json({ message: "Kategori berhasil dihapus" });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("delete category error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
