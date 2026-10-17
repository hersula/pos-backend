import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { StockInsufficientError } from "@/lib/inventory";
import { calculateSaleTotals } from "@/lib/sales";
import { createSaleInTx, freeLimitBlock } from "@/lib/sale-service";

// ================= GET — riwayat penjualan =================
export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const { searchParams } = new URL(req.url);

    const status = searchParams.get("status") ?? undefined;
    const warehouseId = searchParams.get("warehouseId") ?? undefined;
    const cashierId = searchParams.get("cashierId") ?? undefined;
    const dateFrom = searchParams.get("dateFrom") ?? undefined; // YYYY-MM-DD
    const dateTo = searchParams.get("dateTo") ?? undefined;
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? 20)));

    const where: Prisma.SaleWhereInput = {
      tenantId: user.tenantId,
      ...(status ? { status: status as any } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(cashierId ? { cashierId } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lt: new Date(new Date(dateTo).getTime() + 24 * 60 * 60 * 1000) } : {}),
            },
          }
        : {}),
    };

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          items: { include: { product: true } },
          payments: true,
          cashier: { select: { id: true, name: true } },
          customer: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.sale.count({ where }),
    ]);

    return NextResponse.json({
      data: sales,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list sales error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

// ================= POST — buat transaksi penjualan =================
const itemSchema = z.object({
  productId: z.string(),
  productUnitId: z.string().optional(), // kalau dijual pakai satuan tambahan (mis. "Dus"), bukan satuan dasar
  qty: z.number().int().positive(), // qty dalam satuan yang dipilih (productUnitId), BUKAN selalu satuan dasar
  unitPrice: z.number().min(0).optional(), // kalau tidak diisi, ambil dari sellPrice satuan/produk saat ini
  discountAmount: z.number().min(0).default(0), // diskon nominal per item, opsional
});

const paymentSchema = z.object({
  method: z.enum(["CASH", "DEBIT", "CREDIT", "QRIS", "TRANSFER", "EWALLET"]),
  amount: z.number().positive(),
  referenceNo: z.string().optional(),
});

const createSaleSchema = z.object({
  warehouseId: z.string(),
  customerId: z.string().optional(),
  items: z.array(itemSchema).min(1, "Minimal 1 item dalam keranjang"),
  discountType: z.enum(["PERCENT", "NOMINAL"]).default("NOMINAL"),
  discountValue: z.number().min(0).default(0),
  taxPercent: z.number().min(0).max(100).default(11),
  payments: z.array(paymentSchema).min(1, "Minimal 1 metode pembayaran"),
  note: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "KASIR"]);

    // Batasi 10 transaksi/hari untuk tenant paket FREE (SUBSCRIBE tidak kena batas).
    const limitBlock = await freeLimitBlock(user.tenantId);
    if (limitBlock) return NextResponse.json(limitBlock, { status: 403 });

    const parsed = createSaleSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const data = parsed.data;

    const warehouse = await prisma.warehouse.findFirst({ where: { id: data.warehouseId, tenantId: user.tenantId } });
    if (!warehouse) return NextResponse.json({ message: "Gudang/toko tidak ditemukan" }, { status: 404 });
    if (warehouse.type === "CONSIGNMENT") {
      return NextResponse.json(
        { message: "Gudang konsinyasi tidak bisa dipakai untuk penjualan biasa. Gunakan pencatatan terjual pada dokumen konsinyasi.", code: "CONSIGNMENT_WAREHOUSE" },
        { status: 400 }
      );
    }
    if (data.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: data.customerId, tenantId: user.tenantId }, select: { id: true } });
      if (!customer) return NextResponse.json({ message: "Pelanggan tidak ditemukan" }, { status: 404 });
    }

    // Ambil semua produk sekaligus (beserta satuan tambahannya) utk validasi kepemilikan tenant & harga default
    const productIds = data.items.map((it) => it.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, tenantId: user.tenantId },
      include: { units: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of data.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        return NextResponse.json({ message: `Produk dengan id ${item.productId} tidak ditemukan` }, { status: 404 });
      }
      if (item.productUnitId && !product.units.some((u) => u.id === item.productUnitId)) {
        return NextResponse.json(
          { message: `Satuan yang dipilih untuk produk "${product.name}" tidak ditemukan` },
          { status: 404 }
        );
      }
    }

    // Resolusi satuan (konversi ke satuan dasar utk stok/HPP) & unitPrice default
    const resolvedItems = data.items.map((item) => {
      const product = productMap.get(item.productId)!;
      const unit = item.productUnitId ? product.units.find((u) => u.id === item.productUnitId) : undefined;
      return {
        ...item,
        unitPrice: item.unitPrice ?? Number(unit?.sellPrice ?? product.sellPrice),
        unitLabel: unit?.name ?? null,
        conversionQty: unit?.conversionQty ?? 1,
      };
    });

    const totals = calculateSaleTotals({
      items: resolvedItems,
      discountType: data.discountType,
      discountValue: data.discountValue,
      taxPercent: data.taxPercent,
    });

    const costPriceByProduct = new Map(products.map((pr) => [pr.id, Number(pr.costPrice)]));

    const sale = await prisma.$transaction((tx: Prisma.TransactionClient) =>
      createSaleInTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        warehouseId: data.warehouseId,
        customerId: data.customerId,
        items: resolvedItems,
        costPriceByProduct,
        totals,
        discountType: data.discountType,
        discountValue: data.discountValue,
        taxPercent: data.taxPercent,
        payments: data.payments,
        note: data.note,
      })
    );

    return NextResponse.json(
      { message: "Transaksi berhasil disimpan", data: sale },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    if (err instanceof StockInsufficientError) {
      return NextResponse.json({ message: `Stok tidak mencukupi: ${err.message}` }, { status: 400 });
    }
    console.error("create sale error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

