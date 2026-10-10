import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? undefined;

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: { tenantId: user.tenantId, ...(status ? { status: status as any } : {}) },
      include: { supplier: true, warehouse: true, items: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ data: purchaseOrders });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list purchase orders error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const itemSchema = z.object({
  productId: z.string(),
  productUnitId: z.string().optional(), // kalau beli pakai satuan tambahan (mis. "Dus"), bukan satuan dasar
  qty: z.number().int().positive(), // qty dalam satuan yang dipilih (productUnitId), BUKAN selalu satuan dasar
  unitCost: z.number().min(0), // harga beli per satuan yang dipilih
});

const createSchema = z.object({
  supplierId: z.string().optional(),
  warehouseId: z.string(),
  paymentMethod: z.enum(["CASH", "CREDIT", "TRANSFER"]).default("CASH"),
  items: z.array(itemSchema).min(1, "Minimal 1 item pembelian"),
});

export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG"]);

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const { supplierId, warehouseId, paymentMethod, items } = parsed.data;

    const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, tenantId: user.tenantId } });
    if (!warehouse) return NextResponse.json({ message: "Gudang tidak ditemukan" }, { status: 404 });

    // Ambil produk + satuan tambahannya utk validasi productUnitId & snapshot konversi
    const productIds = items.map((it) => it.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, tenantId: user.tenantId },
      include: { units: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const it of items) {
      const product = productMap.get(it.productId);
      if (!product) return NextResponse.json({ message: `Produk dengan id ${it.productId} tidak ditemukan` }, { status: 404 });
      if (it.productUnitId && !product.units.some((u) => u.id === it.productUnitId)) {
        return NextResponse.json(
          { message: `Satuan yang dipilih untuk produk "${product.name}" tidak ditemukan` },
          { status: 404 }
        );
      }
    }

    const resolvedItems = items.map((it) => {
      const product = productMap.get(it.productId)!;
      const unit = it.productUnitId ? product.units.find((u) => u.id === it.productUnitId) : undefined;
      return { ...it, unitLabel: unit?.name ?? null, conversionQty: unit?.conversionQty ?? 1 };
    });

    const total = resolvedItems.reduce((sum, it) => sum + it.qty * it.unitCost, 0);
    const poNumber = `PO-${Date.now()}`; // sederhana & unik; bisa diganti format PO-YYYYMMDD-0001 sesuai kebutuhan

    const po = await prisma.purchaseOrder.create({
      data: {
        tenantId: user.tenantId,
        supplierId,
        warehouseId,
        poNumber,
        status: "DRAFT",
        total,
        paymentMethod,
        createdBy: user.userId,
        items: {
          create: resolvedItems.map((it) => ({
            productId: it.productId,
            productUnitId: it.productUnitId,
            unitLabel: it.unitLabel,
            conversionQty: it.conversionQty,
            qty: it.qty,
            unitCost: it.unitCost,
            subtotal: it.qty * it.unitCost,
          })),
        },
      },
      include: { items: true },
    });

    return NextResponse.json(
      { message: "Purchase order berhasil dibuat (status DRAFT, stok belum bertambah sampai di-receive)", data: po },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("create purchase order error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
