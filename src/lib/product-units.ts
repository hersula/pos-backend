import { Prisma } from "@prisma/client";
import { z } from "zod";

type TxClient = Prisma.TransactionClient;

export const unitSchema = z.object({
  id: z.string().optional(), // ada = update satuan yang sudah ada; kosong = satuan baru
  name: z.string().min(1, "Nama satuan wajib diisi"),
  conversionQty: z.number().int().positive("Konversi harus lebih dari 0"),
  sellPrice: z.number().min(0),
  barcode: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type UnitInput = z.infer<typeof unitSchema>;

export class DuplicateBarcodeError extends Error {}

/**
 * Pastikan barcode tiap satuan tambahan belum dipakai produk/satuan lain di tenant yang sama.
 * `productId` = produk yang sedang dibuat/diedit (boleh berbagi barcode dgn satuan miliknya sendiri,
 * bukan dianggap duplikat).
 */
export async function assertUnitBarcodesAvailable(
  tx: TxClient,
  tenantId: string,
  units: UnitInput[],
  productId?: string
) {
  for (const u of units) {
    if (!u.barcode) continue;

    const dupProduct = await tx.product.findFirst({
      where: { tenantId, barcode: u.barcode, ...(productId ? { NOT: { id: productId } } : {}) },
    });
    if (dupProduct) throw new DuplicateBarcodeError(`Barcode "${u.barcode}" sudah dipakai produk lain`);

    const dupUnit = await tx.productUnit.findFirst({
      where: { tenantId, barcode: u.barcode, isActive: true, ...(u.id ? { NOT: { id: u.id } } : {}) },
    });
    if (dupUnit) throw new DuplicateBarcodeError(`Barcode "${u.barcode}" sudah dipakai satuan lain`);
  }
}

/**
 * Samakan satuan tambahan produk dengan payload dari client: update yang punya id,
 * buat baru yang tidak punya id, dan NONAKTIFKAN (bukan hapus) satuan lama yang tidak
 * lagi ada di payload — supaya SaleItem/PurchaseOrderItem lama yang masih merujuk
 * satuan itu tetap valid (lihat snapshot unitLabel/conversionQty di kedua tabel itu).
 */
export async function syncProductUnits(tx: TxClient, tenantId: string, productId: string, units: UnitInput[]) {
  const existing = await tx.productUnit.findMany({ where: { productId, tenantId } });
  const incomingIds = new Set(units.filter((u) => u.id).map((u) => u.id!));

  const toDeactivate = existing.filter((e) => !incomingIds.has(e.id));
  if (toDeactivate.length > 0) {
    await tx.productUnit.updateMany({
      where: { id: { in: toDeactivate.map((e) => e.id) } },
      data: { isActive: false },
    });
  }

  for (const u of units) {
    if (u.id) {
      await tx.productUnit.update({
        where: { id: u.id },
        data: {
          name: u.name,
          conversionQty: u.conversionQty,
          sellPrice: u.sellPrice,
          barcode: u.barcode,
          isActive: true,
        },
      });
    } else {
      await tx.productUnit.create({
        data: {
          tenantId,
          productId,
          name: u.name,
          conversionQty: u.conversionQty,
          sellPrice: u.sellPrice,
          barcode: u.barcode,
        },
      });
    }
  }
}
