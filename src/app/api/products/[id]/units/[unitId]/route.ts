import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

async function loadUnit(productId: string, unitId: string, tenantId: string) {
  const unit = await prisma.productUnit.findFirst({
    where: { id: unitId, productId, product: { tenantId } },
  });
  return unit;
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  conversionQty: z.number().positive().optional(),
  barcode: z.string().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string; unitId: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG"]);

    const existing = await loadUnit(params.id, params.unitId, user.tenantId);
    if (!existing) return NextResponse.json({ message: "Satuan tidak ditemukan" }, { status: 404 });

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    if (parsed.data.name) {
      const dup = await prisma.productUnit.findFirst({
        where: { productId: params.id, name: parsed.data.name, NOT: { id: params.unitId } },
      });
      if (dup) return NextResponse.json({ message: "Satuan dengan nama ini sudah ada untuk produk ini" }, { status: 409 });
    }

    const updated = await prisma.productUnit.update({ where: { id: params.unitId }, data: parsed.data });
    return NextResponse.json({ message: "Satuan berhasil diperbarui", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("update product unit error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string; unitId: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG"]);

    const existing = await loadUnit(params.id, params.unitId, user.tenantId);
    if (!existing) return NextResponse.json({ message: "Satuan tidak ditemukan" }, { status: 404 });

    const usedInTransaction = await prisma.saleItem.findFirst({ where: { productUnitId: params.unitId } });
    if (usedInTransaction) {
      return NextResponse.json(
        { message: "Satuan ini sudah dipakai di transaksi penjualan dan tidak bisa dihapus" },
        { status: 409 }
      );
    }

    await prisma.$transaction([
      prisma.productPrice.deleteMany({ where: { productUnitId: params.unitId } }),
      prisma.productUnit.delete({ where: { id: params.unitId } }),
    ]);

    return NextResponse.json({ message: "Satuan berhasil dihapus" });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("delete product unit error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
