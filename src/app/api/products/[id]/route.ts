import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);

    const product = await prisma.product.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: { category: true, stocks: { include: { warehouse: true } } },
    });
    if (!product) return NextResponse.json({ message: "Produk tidak ditemukan" }, { status: 404 });

    return NextResponse.json({ data: product });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("get product error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const updateSchema = z.object({
  categoryId: z.string().nullable().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  name: z.string().min(2).optional(),
  unit: z.string().optional(),
  costPrice: z.number().min(0).optional(),
  sellPrice: z.number().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  imageUrl: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG"]);

    const existing = await prisma.product.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!existing) return NextResponse.json({ message: "Produk tidak ditemukan" }, { status: 404 });

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const updated = await prisma.product.update({ where: { id: params.id }, data: parsed.data });
    return NextResponse.json({ message: "Produk berhasil diperbarui", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("update product error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

// Soft delete — produk dinonaktifkan, bukan dihapus permanen, supaya histori transaksi lama tetap valid
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);

    const existing = await prisma.product.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!existing) return NextResponse.json({ message: "Produk tidak ditemukan" }, { status: 404 });

    await prisma.product.update({ where: { id: params.id }, data: { isActive: false } });
    return NextResponse.json({ message: "Produk berhasil dinonaktifkan" });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("delete product error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
