import { Prisma } from "@prisma/client";
import { z } from "zod";

type TxClient = Prisma.TransactionClient;

export const productPriceSchema = z.object({
  priceLevelId: z.string(),
  sellPrice: z.number().min(0),
});

export type ProductPriceInput = z.infer<typeof productPriceSchema>;

export class InvalidPriceLevelError extends Error {}

/**
 * Samakan harga per level produk dengan payload dari client. Beda dengan satuan
 * (ProductUnit), di sini aman hapus-lalu-buat-ulang (replace penuh) karena SaleItem
 * sudah snapshot unitPrice sendiri sebagai angka final -- tidak pernah merujuk balik
 * ke ProductPrice/PriceLevel, jadi tidak ada histori transaksi yang bisa rusak.
 */
export async function syncProductPrices(tx: TxClient, tenantId: string, productId: string, prices: ProductPriceInput[]) {
  if (prices.length > 0) {
    const levelIds = prices.map((p) => p.priceLevelId);
    const validLevels = await tx.priceLevel.findMany({ where: { id: { in: levelIds }, tenantId } });
    if (validLevels.length !== new Set(levelIds).size) {
      throw new InvalidPriceLevelError("Salah satu level harga tidak ditemukan");
    }
  }

  await tx.productPrice.deleteMany({ where: { productId } });

  if (prices.length > 0) {
    await tx.productPrice.createMany({
      data: prices.map((p) => ({
        tenantId,
        productId,
        priceLevelId: p.priceLevelId,
        sellPrice: p.sellPrice,
      })),
    });
  }
}
