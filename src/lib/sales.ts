import { Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

export type SaleItemInput = {
  productId: string;
  qty: number;
  unitPrice: number;
  discountAmount?: number; // diskon nominal per item, opsional
};

export type SaleCalculation = {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  grandTotal: number;
};

/**
 * Menghitung subtotal, diskon (level struk), PPN, dan grand total.
 * Rumus:
 *   subtotal        = SUM(qty * unitPrice - itemDiscount)
 *   discountAmount   = PERCENT -> subtotal * (value/100) | NOMINAL -> value
 *   taxableAmount    = subtotal - discountAmount
 *   taxAmount        = taxableAmount * (taxPercent/100)
 *   grandTotal       = taxableAmount + taxAmount
 */
export function calculateSaleTotals(params: {
  items: SaleItemInput[];
  discountType: "PERCENT" | "NOMINAL";
  discountValue: number;
  taxPercent: number;
}): SaleCalculation {
  const { items, discountType, discountValue, taxPercent } = params;

  const subtotal = items.reduce((sum, item) => {
    const lineTotal = item.qty * item.unitPrice - (item.discountAmount ?? 0);
    return sum + lineTotal;
  }, 0);

  const discountAmount =
    discountType === "PERCENT" ? round2(subtotal * (discountValue / 100)) : round2(discountValue);

  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const taxAmount = round2(taxableAmount * (taxPercent / 100));
  const grandTotal = round2(taxableAmount + taxAmount);

  return {
    subtotal: round2(subtotal),
    discountAmount,
    taxableAmount: round2(taxableAmount),
    taxAmount,
    grandTotal,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Generate nomor invoice unik per tenant, format: INV-YYYYMMDD-0001
 * Sequence dihitung dari jumlah sale yang sudah dibuat tenant tsb hari ini.
 * Dipanggil di dalam transaction yang sama dengan pembuatan sale untuk minimalkan race condition.
 */
export async function generateInvoiceNumber(tx: TxClient, tenantId: string) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}`;

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const countToday = await tx.sale.count({
    where: { tenantId, createdAt: { gte: startOfDay, lt: endOfDay } },
  });

  const sequence = String(countToday + 1).padStart(4, "0");
  return `INV-${dateStr}-${sequence}`;
}
