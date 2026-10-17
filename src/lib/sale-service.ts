import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { adjustStock } from "@/lib/inventory";
import { generateInvoiceNumber, type SaleCalculation } from "@/lib/sales";
import { postSaleJournal } from "@/lib/accounting";
import { checkFreeTransactionLimit, FREE_DAILY_TRANSACTION_LIMIT } from "@/lib/subscription";

type TxClient = Prisma.TransactionClient;

export type PaymentMethodInput = "CASH" | "DEBIT" | "CREDIT" | "QRIS" | "TRANSFER" | "EWALLET";

export type ResolvedSaleItem = {
  productId: string;
  productUnitId?: string | null;
  unitLabel: string | null;
  conversionQty: number; // snapshot konversi ke satuan dasar
  qty: number; // dalam satuan yang dipilih
  unitPrice: number;
  discountAmount?: number;
};

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Untuk tenant paket FREE: kembalikan body error 403 bila kuota transaksi harian habis, selain itu null.
 * Dipakai bersama oleh POST /api/sales dan settle-sale konsinyasi.
 */
export async function freeLimitBlock(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { planType: true } });
  if (tenant?.planType !== "FREE") return null;
  const limitCheck = await checkFreeTransactionLimit(tenantId);
  if (limitCheck.allowed) return null;
  return {
    message: `Paket Gratis dibatasi ${FREE_DAILY_TRANSACTION_LIMIT} transaksi per hari. Kamu sudah mencapai batas ini hari ini — upgrade ke Berlangganan untuk transaksi tanpa batas.`,
    code: "FREE_LIMIT_REACHED",
    used: limitCheck.used,
    limit: limitCheck.limit,
  };
}

/**
 * Inti pembuatan Sale: simpan sale + item + pembayaran, kurangi stok (qty x conversionQty, satuan dasar),
 * dan posting jurnal penjualan (termasuk piutang bila belum lunas, dan HPP). WAJIB di dalam prisma.$transaction.
 * Validasi tenant atas warehouse/customer/produk/satuan adalah tanggung jawab pemanggil.
 */
export async function createSaleInTx(
  tx: TxClient,
  p: {
    tenantId: string;
    userId: string;
    warehouseId: string;
    customerId?: string | null;
    items: ResolvedSaleItem[];
    costPriceByProduct: Map<string, number>; // costPrice per satuan dasar
    totals: SaleCalculation;
    discountType: "PERCENT" | "NOMINAL";
    discountValue: number;
    taxPercent: number;
    payments: { method: PaymentMethodInput; amount: number; referenceNo?: string }[];
    note?: string;
    consignmentOrderId?: string;
  }
) {
  const paidTotal = round2(p.payments.reduce((sum, x) => sum + x.amount, 0));
  const changeAmount = paidTotal > p.totals.grandTotal ? round2(paidTotal - p.totals.grandTotal) : 0;
  const status: "PAID" | "PARTIAL" = paidTotal >= p.totals.grandTotal ? "PAID" : "PARTIAL";

  const invoiceNo = await generateInvoiceNumber(tx, p.tenantId);

  const newSale = await tx.sale.create({
    data: {
      tenantId: p.tenantId,
      warehouseId: p.warehouseId,
      customerId: p.customerId ?? undefined,
      consignmentOrderId: p.consignmentOrderId,
      invoiceNo,
      cashierId: p.userId,
      subtotal: p.totals.subtotal,
      discountType: p.discountType,
      discountValue: p.discountValue,
      discountAmount: p.totals.discountAmount,
      taxPercent: p.taxPercent,
      taxAmount: p.totals.taxAmount,
      grandTotal: p.totals.grandTotal,
      paidTotal,
      changeAmount,
      status,
      note: p.note,
      items: {
        create: p.items.map((item) => ({
          productId: item.productId,
          productUnitId: item.productUnitId ?? undefined,
          unitLabel: item.unitLabel,
          conversionQty: item.conversionQty,
          qty: item.qty,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount ?? 0,
          subtotal: item.qty * item.unitPrice - (item.discountAmount ?? 0),
        })),
      },
      payments: {
        create: p.payments.map((x) => ({ method: x.method, amount: x.amount, referenceNo: x.referenceNo })),
      },
    },
    include: {
      items: { include: { product: true } },
      payments: true,
      cashier: { select: { id: true, name: true } },
      customer: true,
      warehouse: true,
      tenant: { select: { businessName: true, address: true, phone: true } },
    },
  });

  // Kurangi stok selalu dalam satuan dasar (qty x conversionQty) — 2 Dus @ 24 Botol/Dus = 48 Botol.
  for (const item of p.items) {
    await adjustStock(tx, {
      tenantId: p.tenantId,
      productId: item.productId,
      warehouseId: p.warehouseId,
      type: "OUT",
      qty: item.qty * item.conversionQty,
      direction: -1,
      referenceType: "SALE",
      referenceId: newSale.id,
      note: `Penjualan ${invoiceNo}`,
      createdBy: p.userId,
    });
  }

  // costPrice produk per satuan dasar, jadi HPP ikut dikali conversionQty.
  const cogsAmount = p.items.reduce(
    (sum, item) => sum + item.qty * item.conversionQty * (p.costPriceByProduct.get(item.productId) ?? 0),
    0
  );

  await postSaleJournal(tx, {
    tenantId: p.tenantId,
    saleId: newSale.id,
    invoiceNo,
    entryDate: newSale.createdAt,
    payments: p.payments,
    taxableAmount: p.totals.taxableAmount,
    taxAmount: p.totals.taxAmount,
    grandTotal: p.totals.grandTotal,
    paidTotal,
    cogsAmount,
  });

  return newSale;
}
