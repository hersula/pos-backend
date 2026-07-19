import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { adjustStock } from "@/lib/inventory";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const { searchParams } = new URL(req.url);

    const search = searchParams.get("search") ?? undefined;
    const categoryId = searchParams.get("categoryId") ?? undefined;
    const lowStockOnly = searchParams.get("lowStock") === "true";
    const includeInactive = searchParams.get("includeInactive") === "true";
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? 20)));

    const where = {
      tenantId: user.tenantId,
      ...(includeInactive ? {} : { isActive: true }),
      ...(categoryId ? { categoryId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { sku: { contains: search } },
              { barcode: { contains: search } },
            ],
          }
        : {}),
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: true, stocks: { include: { warehouse: true } } },
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.product.count({ where }),
    ]);

    // Total stok gabungan semua warehouse per produk (utk tampilan list & cek low stock)
    let result = products.map((p) => ({
      ...p,
      totalStock: p.stocks.reduce((sum, s) => sum + s.quantity, 0),
    }));

    if (lowStockOnly) {
      result = result.filter((p) => p.totalStock <= p.minStock);
    }

    return NextResponse.json({
      data: result,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list products error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const createSchema = z.object({
  categoryId: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  name: z.string().min(2, "Nama produk minimal 2 karakter"),
  unit: z.string().default("pcs"),
  costPrice: z.number().min(0).default(0),
  sellPrice: z.number().min(0),
  minStock: z.number().int().min(0).default(0),
  imageUrl: z.string().optional(),
  // stok awal opsional saat produk pertama kali dibuat
  initialStock: z
    .object({
      warehouseId: z.string(),
      quantity: z.number().int().min(0),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG"]);

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const data = parsed.data;

    if (data.barcode) {
      const dup = await prisma.product.findFirst({ where: { tenantId: user.tenantId, barcode: data.barcode } });
      if (dup) return NextResponse.json({ message: "Barcode sudah dipakai produk lain" }, { status: 409 });
    }

    const product = await prisma.$transaction(async (tx) => {
      const newProduct = await tx.product.create({
        data: {
          tenantId: user.tenantId,
          categoryId: data.categoryId,
          sku: data.sku,
          barcode: data.barcode,
          name: data.name,
          unit: data.unit,
          costPrice: data.costPrice,
          sellPrice: data.sellPrice,
          minStock: data.minStock,
          imageUrl: data.imageUrl,
        },
      });

      if (data.initialStock && data.initialStock.quantity > 0) {
        await adjustStock(tx, {
          tenantId: user.tenantId,
          productId: newProduct.id,
          warehouseId: data.initialStock.warehouseId,
          type: "IN",
          qty: data.initialStock.quantity,
          direction: 1,
          referenceType: "MANUAL",
          note: "Stok awal saat produk dibuat",
          createdBy: user.userId,
        });
      }

      return newProduct;
    });

    return NextResponse.json({ message: "Produk berhasil dibuat", data: product }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("create product error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
