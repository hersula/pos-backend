import { Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

type MovementType = "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";

/**
 * Menambah/mengurangi stok produk di sebuah warehouse, sekaligus mencatat jejaknya
 * di stock_movements (kartu stok). WAJIB dipanggil di dalam prisma.$transaction
 * supaya perubahan quantity & pencatatan movement selalu konsisten.
 *
 * qty selalu diisi POSITIF. Arah pergerakan ditentukan oleh `type`:
 *  - IN / ADJUSTMENT(+)  -> menambah stok
 *  - OUT                 -> mengurangi stok
 */
export async function adjustStock(
  tx: TxClient,
  params: {
    tenantId: string;
    productId: string;
    warehouseId: string;
    type: MovementType;
    qty: number; // selalu positif
    direction: 1 | -1; // 1 = tambah, -1 = kurangi
    referenceType?: string; // 'PURCHASE' | 'SALE' | 'MANUAL' | 'TRANSFER'
    referenceId?: string;
    note?: string;
    createdBy?: string;
    allowNegative?: boolean; // default false, penjualan harus false
  }
) {
  const {
    tenantId,
    productId,
    warehouseId,
    type,
    qty,
    direction,
    referenceType,
    referenceId,
    note,
    createdBy,
    allowNegative = false,
  } = params;

  if (qty <= 0) {
    throw new Error("Jumlah qty harus lebih dari 0");
  }

  const existingStock = await tx.stock.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
  });

  const currentQty = existingStock?.quantity ?? 0;
  const newQty = currentQty + direction * qty;

  if (!allowNegative && newQty < 0) {
    throw new StockInsufficientError(productId, currentQty, qty);
  }

  if (existingStock) {
    await tx.stock.update({
      where: { id: existingStock.id },
      data: { quantity: newQty },
    });
  } else {
    await tx.stock.create({
      data: { tenantId, productId, warehouseId, quantity: newQty },
    });
  }

  await tx.stockMovement.create({
    data: {
      tenantId,
      productId,
      warehouseId,
      type,
      qty,
      referenceType,
      referenceId,
      note,
      createdBy,
    },
  });

  return newQty;
}

export class StockInsufficientError extends Error {
  productId: string;
  currentQty: number;
  requestedQty: number;
  constructor(productId: string, currentQty: number, requestedQty: number) {
    super(`Stok tidak mencukupi. Tersedia: ${currentQty}, diminta: ${requestedQty}`);
    this.productId = productId;
    this.currentQty = currentQty;
    this.requestedQty = requestedQty;
  }
}
