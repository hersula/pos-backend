import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { adjustStock, StockInsufficientError } from "@/lib/inventory";

// GET — kartu stok: histori keluar-masuk barang, filter per produk/warehouse
export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId") ?? undefined;
    const warehouseId = searchParams.get("warehouseId") ?? undefined;
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? 30)));

    const where = {
      tenantId: user.tenantId,
      ...(productId ? { productId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
    };

    const [movements, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        include: { product: true, warehouse: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.stockMovement.count({ where }),
    ]);

    return NextResponse.json({
      data: movements,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list stock movements error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

// POST — koreksi/adjustment stok manual (mis. hasil stok opname, barang rusak/hilang)
const adjustSchema = z.object({
  productId: z.string(),
  warehouseId: z.string(),
  direction: z.enum(["IN", "OUT"]), // IN = tambah, OUT = kurangi
  qty: z.number().int().positive(),
  note: z.string().min(3, "Catatan alasan koreksi wajib diisi"),
});

export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG"]);

    const parsed = adjustSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const { productId, warehouseId, direction, qty, note } = parsed.data;

    const product = await prisma.product.findFirst({ where: { id: productId, tenantId: user.tenantId } });
    if (!product) return NextResponse.json({ message: "Produk tidak ditemukan" }, { status: 404 });

    const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, tenantId: user.tenantId } });
    if (!warehouse) return NextResponse.json({ message: "Gudang tidak ditemukan" }, { status: 404 });

    const newQty = await prisma.$transaction((tx) =>
      adjustStock(tx, {
        tenantId: user.tenantId,
        productId,
        warehouseId,
        type: "ADJUSTMENT",
        qty,
        direction: direction === "IN" ? 1 : -1,
        referenceType: "MANUAL",
        note,
        createdBy: user.userId,
      })
    );

    return NextResponse.json({ message: "Stok berhasil disesuaikan", newQuantity: newQty });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    if (err instanceof StockInsufficientError) {
      return NextResponse.json({ message: err.message }, { status: 400 });
    }
    console.error("adjust stock error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
