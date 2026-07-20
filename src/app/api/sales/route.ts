import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { adjustStock, StockInsufficientError } from "@/lib/inventory";
import { calculateSaleTotals, generateInvoiceNumber } from "@/lib/sales";
import { postSaleJournal } from "@/lib/accounting";

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
  qty: z.number().int().positive(),
  unitPrice: z.number().min(0).optional(), // kalau tidak diisi, ambil dari sellPrice produk saat ini
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

    const parsed = createSaleSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const data = parsed.data;

    const warehouse = await prisma.warehouse.findFirst({ where: { id: data.warehouseId, tenantId: user.tenantId } });
    if (!warehouse) return NextResponse.json({ message: "Gudang/toko tidak ditemukan" }, { status: 404 });

    // Ambil semua produk sekaligus untuk validasi kepemilikan tenant & harga default
    const productIds = data.items.map((it) => it.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, tenantId: user.tenantId },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of data.items) {
      if (!productMap.has(item.productId)) {
        return NextResponse.json({ message: `Produk dengan id ${item.productId} tidak ditemukan` }, { status: 404 });
      }
    }

    // Resolusi unitPrice: pakai yang dikirim client kalau ada, kalau tidak pakai sellPrice produk saat ini
    const resolvedItems = data.items.map((item) => {
      const product = productMap.get(item.productId)!;
      return {
        ...item,
        unitPrice: item.unitPrice ?? Number(product.sellPrice),
      };
    });

    const totals = calculateSaleTotals({
      items: resolvedItems,
      discountType: data.discountType,
      discountValue: data.discountValue,
      taxPercent: data.taxPercent,
    });

    const paidTotal = round2(data.payments.reduce((sum, p) => sum + p.amount, 0));
    const changeAmount = paidTotal > totals.grandTotal ? round2(paidTotal - totals.grandTotal) : 0;
    const status: "PAID" | "PARTIAL" = paidTotal >= totals.grandTotal ? "PAID" : "PARTIAL";

    const sale = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const invoiceNo = await generateInvoiceNumber(tx, user.tenantId);

      const newSale = await tx.sale.create({
        data: {
          tenantId: user.tenantId,
          warehouseId: data.warehouseId,
          customerId: data.customerId,
          invoiceNo,
          cashierId: user.userId,
          subtotal: totals.subtotal,
          discountType: data.discountType,
          discountValue: data.discountValue,
          discountAmount: totals.discountAmount,
          taxPercent: data.taxPercent,
          taxAmount: totals.taxAmount,
          grandTotal: totals.grandTotal,
          paidTotal,
          changeAmount,
          status,
          note: data.note,
          items: {
            create: resolvedItems.map((item) => ({
              productId: item.productId,
              qty: item.qty,
              unitPrice: item.unitPrice,
              discountAmount: item.discountAmount ?? 0,
              subtotal: item.qty * item.unitPrice - (item.discountAmount ?? 0),
            })),
          },
          payments: {
            create: data.payments.map((p) => ({
              method: p.method,
              amount: p.amount,
              referenceNo: p.referenceNo,
            })),
          },
        },
        include: { items: { include: { product: true } }, payments: true },
      });

      // Kurangi stok untuk setiap item (akan otomatis gagal/rollback kalau stok tidak cukup)
      for (const item of resolvedItems) {
        await adjustStock(tx, {
          tenantId: user.tenantId,
          productId: item.productId,
          warehouseId: data.warehouseId,
          type: "OUT",
          qty: item.qty,
          direction: -1,
          referenceType: "SALE",
          referenceId: newSale.id,
          note: `Penjualan ${invoiceNo}`,
          createdBy: user.userId,
        });
      }

      // Jurnal akunting otomatis: Kas/Bank & Piutang (debit) vs Pendapatan & PPN (kredit),
      // plus HPP (debit) vs Persediaan (kredit) dari harga modal barang yang terjual
      const cogsAmount = resolvedItems.reduce((sum, item) => {
        const product = productMap.get(item.productId)!;
        return sum + item.qty * Number(product.costPrice);
      }, 0);

      await postSaleJournal(tx, {
        tenantId: user.tenantId,
        saleId: newSale.id,
        invoiceNo,
        entryDate: newSale.createdAt,
        payments: data.payments,
        taxableAmount: totals.taxableAmount,
        taxAmount: totals.taxAmount,
        grandTotal: totals.grandTotal,
        paidTotal,
        cogsAmount,
      });

      return newSale;
    });

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

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
