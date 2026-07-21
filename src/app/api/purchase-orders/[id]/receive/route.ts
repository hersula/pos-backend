import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { adjustStock } from "@/lib/inventory";
import { postPurchaseJournal } from "@/lib/accounting";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG"]);

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: { items: true },
    });
    if (!po) return NextResponse.json({ message: "Purchase order tidak ditemukan" }, { status: 404 });
    if (po.status === "RECEIVED") {
      return NextResponse.json({ message: "Purchase order ini sudah pernah di-receive" }, { status: 409 });
    }
    if (po.status === "CANCELLED") {
      return NextResponse.json({ message: "Purchase order ini sudah dibatalkan" }, { status: 409 });
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const item of po.items) {
        // Tambah stok di gudang tujuan PO
        await adjustStock(tx, {
          tenantId: user.tenantId,
          productId: item.productId,
          warehouseId: po.warehouseId,
          type: "IN",
          qty: item.qty,
          direction: 1,
          referenceType: "PURCHASE",
          referenceId: po.id,
          note: `Penerimaan barang PO ${po.poNumber}`,
          createdBy: user.userId,
        });

        // Update harga modal produk mengikuti harga beli terbaru (metode: harga beli terakhir)
        await tx.product.update({
          where: { id: item.productId },
          data: { costPrice: item.unitCost },
        });
      }

      // CASH/TRANSFER dianggap lunas seketika saat barang diterima; CREDIT (tempo) jadi hutang usaha
      const isPaidImmediately = po.paymentMethod === "CASH" || po.paymentMethod === "TRANSFER";

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: "RECEIVED",
          paymentStatus: isPaidImmediately ? "PAID" : "UNPAID",
          paidAmount: isPaidImmediately ? po.total : 0,
        },
      });

      // Jurnal akunting otomatis: Debit Persediaan, Kredit Kas/Bank/Hutang Usaha (tergantung metode bayar)
      await postPurchaseJournal(tx, {
        tenantId: user.tenantId,
        poId: po.id,
        poNumber: po.poNumber,
        entryDate: new Date(),
        total: Number(po.total),
        paymentMethod: po.paymentMethod,
      });
    });

    return NextResponse.json({ message: `PO ${po.poNumber} berhasil diterima, stok telah diperbarui.` });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("receive purchase order error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
