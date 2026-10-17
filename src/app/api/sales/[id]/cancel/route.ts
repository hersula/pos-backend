import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { adjustStock } from "@/lib/inventory";
import { reverseJournalForReference } from "@/lib/accounting";
import { voidConsignmentSaleInTx } from "@/lib/consignment";

const schema = z.object({
  reason: z.string().min(3, "Alasan pembatalan wajib diisi"),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]); // kasir tidak boleh batalkan transaksi sendiri

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ message: "Alasan pembatalan wajib diisi" }, { status: 400 });

    const sale = await prisma.sale.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: { items: true },
    });
    if (!sale) return NextResponse.json({ message: "Transaksi tidak ditemukan" }, { status: 404 });
    if (sale.status === "CANCELLED" || sale.status === "REFUNDED") {
      return NextResponse.json({ message: "Transaksi ini sudah dibatalkan/refund sebelumnya" }, { status: 409 });
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Cegah pembatalan ganda bila dua request datang bersamaan: hanya satu yang berhasil
      // mengubah status dari non-CANCELLED menjadi CANCELLED.
      const claimed = await tx.sale.updateMany({
        where: { id: sale.id, tenantId: user.tenantId, status: { in: ["PAID", "PARTIAL"] } },
        data: { status: "CANCELLED", note: `${sale.note ?? ""} [DIBATALKAN: ${parsed.data.reason}]`.trim() },
      });
      if (claimed.count === 0) throw new AuthError("Transaksi ini sudah dibatalkan/refund sebelumnya", 409);

      // Kembalikan stok setiap item ke gudang asal, dalam SATUAN DASAR (qty x conversionQty snapshot).
      // Sebelumnya hanya `qty`, sehingga penjualan 2 Dus (=48 Botol) hanya mengembalikan 2.
      for (const item of sale.items) {
        await adjustStock(tx, {
          tenantId: user.tenantId,
          productId: item.productId,
          warehouseId: sale.warehouseId,
          type: "IN",
          qty: item.qty * item.conversionQty,
          direction: 1,
          referenceType: "SALE",
          referenceId: sale.id,
          note: `Pembatalan transaksi ${sale.invoiceNo}: ${parsed.data.reason}`,
          createdBy: user.userId,
          allowNegative: true,
        });
      }

      // Buat jurnal balik (reversing entry) dari jurnal penjualan asal DAN jurnal pelunasan piutangnya
      for (const referenceType of ["SALE", "SALE_PAYMENT"]) {
        await reverseJournalForReference(tx, {
          tenantId: user.tenantId,
          referenceType,
          referenceId: sale.id,
          entryDate: new Date(),
          description: `Pembatalan transaksi ${sale.invoiceNo}: ${parsed.data.reason}`,
        });
      }

      // Sale hasil settle konsinyasi: kurangi baseQtySold & hitung ulang status dokumen konsinyasi
      if (sale.consignmentOrderId) {
        await voidConsignmentSaleInTx(tx, user.tenantId, sale.id);
      }
    });

    return NextResponse.json({ message: `Transaksi ${sale.invoiceNo} berhasil dibatalkan, stok telah dikembalikan.` });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("cancel sale error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
