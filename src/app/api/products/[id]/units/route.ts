import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

// GET /api/products/:id/units — daftar satuan turunan produk (di luar satuan dasar Product.unit)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);

    const product = await prisma.product.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!product) return NextResponse.json({ message: "Produk tidak ditemukan" }, { status: 404 });

    const units = await prisma.productUnit.findMany({
      where: { productId: params.id },
      orderBy: { conversionQty: "asc" },
    });

    return NextResponse.json({
      data: {
        baseUnit: { name: product.unit, conversionQty: 1 },
        units,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list product units error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().min(1, "Nama satuan wajib diisi"),
  // Berapa satuan dasar (Product.unit) terkandung dalam 1 satuan ini. Mis. produk berbasis "pcs",
  // satuan "Box" dengan conversionQty 12 berarti 1 Box = 12 pcs.
  conversionQty: z.number().positive("Konversi harus lebih dari 0"),
  barcode: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG"]);

    const product = await prisma.product.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!product) return NextResponse.json({ message: "Produk tidak ditemukan" }, { status: 404 });

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const data = parsed.data;

    if (data.name.trim().toLowerCase() === product.unit.trim().toLowerCase()) {
      return NextResponse.json({ message: "Nama satuan tidak boleh sama dengan satuan dasar produk" }, { status: 400 });
    }

    const dup = await prisma.productUnit.findFirst({ where: { productId: product.id, name: data.name } });
    if (dup) return NextResponse.json({ message: "Satuan dengan nama ini sudah ada untuk produk ini" }, { status: 409 });

    const unit = await prisma.productUnit.create({
      data: {
        productId: product.id,
        name: data.name,
        conversionQty: data.conversionQty,
        barcode: data.barcode,
      },
    });

    return NextResponse.json({ message: "Satuan berhasil ditambahkan", data: unit }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("create product unit error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
