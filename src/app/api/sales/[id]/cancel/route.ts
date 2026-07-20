import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { adjustStock } from "@/lib/inventory";
import { reverseJournalForReference } from "@/lib/accounting";

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
      // Kembalikan stok setiap item ke gudang asal
      for (const item of sale.items) {
        await adjustStock(tx, {
          tenantId: user.tenantId,
          productId: item.productId,
          warehouseId: sale.warehouseId,
          type: "IN",
          qty: item.qty,
          direction: 1,
          referenceType: "SALE",
          referenceId: sale.id,
          note: `Pembatalan transaksi ${sale.invoiceNo}: ${parsed.data.reason}`,
          createdBy: user.userId,
          allowNegative: true,
        });
      }

      await tx.sale.update({
        where: { id: sale.id },
        data: { status: "CANCELLED", note: `${sale.note ?? ""} [DIBATALKAN: ${parsed.data.reason}]`.trim() },
      });

      // Buat jurnal balik (reversing entry) dari jurnal penjualan asal
      await reverseJournalForReference(tx, {
        tenantId: user.tenantId,
        referenceType: "SALE",
        referenceId: sale.id,
        entryDate: new Date(),
        description: `Pembatalan transaksi ${sale.invoiceNo}: ${parsed.data.reason}`,
      });
    });

    return NextResponse.json({ message: `Transaksi ${sale.invoiceNo} berhasil dibatalkan, stok telah dikembalikan.` });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("cancel sale error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
