import { Prisma } from "@prisma/client";

/**
 * Konversi qty dalam satuan turunan (mis. Box) menjadi qty dalam satuan dasar produk (mis. pcs),
 * memakai conversionQty dari ProductUnit. Kalau tidak ada unit (productUnitId null / undefined),
 * berarti qty sudah dalam satuan dasar sehingga dikembalikan apa adanya.
 */
export function toBaseQty(qty: number, conversionQty?: Prisma.Decimal | number | string | null): number {
  if (conversionQty === null || conversionQty === undefined) return qty;
  return qty * Number(conversionQty);
}
