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
  qty: z.number().int().positive(),
  unitCost: z.number().min(0),
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

    const total = items.reduce((sum, it) => sum + it.qty * it.unitCost, 0);
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
          create: items.map((it) => ({
            productId: it.productId,
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
