import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { postPurchasePaymentJournal } from "@/lib/accounting";

// GET — riwayat cicilan pelunasan hutang untuk satu PO
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: { payments: { orderBy: { createdAt: "desc" } } },
    });
    if (!po) return NextResponse.json({ message: "Purchase order tidak ditemukan" }, { status: 404 });

    return NextResponse.json({ data: po.payments });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list purchase payments error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const schema = z.object({
  method: z.enum(["CASH", "TRANSFER"]), // pelunasan tidak bisa pakai CREDIT lagi
  amount: z.number().positive(),
  referenceNo: z.string().optional(),
});

// POST — catat pembayaran/cicilan hutang usaha dari pembelian tempo
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "AKUNTAN"]);

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data pembayaran tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const { method, amount, referenceNo } = parsed.data;

    const po = await prisma.purchaseOrder.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!po) return NextResponse.json({ message: "Purchase order tidak ditemukan" }, { status: 404 });

    if (po.status !== "RECEIVED") {
      return NextResponse.json({ message: "Barang belum diterima, belum ada hutang yang bisa dibayar" }, { status: 409 });
    }
    if (po.paymentMethod !== "CREDIT") {
      return NextResponse.json({ message: "PO ini bukan pembelian tempo, tidak ada hutang untuk dilunasi" }, { status: 409 });
    }
    if (po.paymentStatus === "PAID") {
      return NextResponse.json({ message: "Hutang untuk PO ini sudah lunas" }, { status: 409 });
    }

    const remaining = Number(po.total) - Number(po.paidAmount);
    if (amount > remaining + 0.01) {
      return NextResponse.json(
        { message: `Jumlah pembayaran melebihi sisa hutang (sisa: ${remaining})` },
        { status: 400 }
      );
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.purchasePayment.create({
        data: { purchaseOrderId: po.id, method, amount, referenceNo },
      });

      const newPaidAmount = Number(po.paidAmount) + amount;
      const newStatus = newPaidAmount >= Number(po.total) - 0.01 ? "PAID" : "PARTIAL";

      const updatedPo = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { paidAmount: newPaidAmount, paymentStatus: newStatus },
        include: { payments: true },
      });

      // Jurnal otomatis: Debit Hutang Usaha, Kredit Kas/Bank
      await postPurchasePaymentJournal(tx, {
        tenantId: user.tenantId,
        poId: po.id,
        poNumber: po.poNumber,
        entryDate: new Date(),
        amount,
        method,
      });

      return updatedPo;
    });

    return NextResponse.json({ message: "Pembayaran hutang berhasil dicatat", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("pay purchase order debt error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
