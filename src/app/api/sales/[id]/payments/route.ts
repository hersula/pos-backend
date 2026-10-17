import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { postSalePaymentJournal } from "@/lib/accounting";

const schema = z.object({
  method: z.enum(["CASH", "DEBIT", "CREDIT", "QRIS", "TRANSFER", "EWALLET"]),
  amount: z.number().positive(),
  referenceNo: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "KASIR"]);

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ message: "Data pembayaran tidak valid" }, { status: 400 });

    const sale = await prisma.sale.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!sale) return NextResponse.json({ message: "Transaksi tidak ditemukan" }, { status: 404 });
    if (sale.status !== "PARTIAL") {
      return NextResponse.json({ message: "Transaksi ini bukan piutang yang menunggu pelunasan" }, { status: 409 });
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Baca ulang di dalam transaksi supaya dua pembayaran paralel tidak menghitung dari paidTotal basi
      const fresh = await tx.sale.findFirst({ where: { id: sale.id, tenantId: user.tenantId } });
      if (!fresh || fresh.status !== "PARTIAL") {
        throw new AuthError("Transaksi ini bukan piutang yang menunggu pelunasan", 409);
      }

      await tx.salePayment.create({
        data: { saleId: fresh.id, method: parsed.data.method, amount: parsed.data.amount, referenceNo: parsed.data.referenceNo },
      });

      const grandTotal = Number(fresh.grandTotal);
      const outstandingBefore = Math.max(0, round2(grandTotal - Number(fresh.paidTotal)));
      const newPaidTotal = round2(Number(fresh.paidTotal) + parsed.data.amount);
      const newStatus = newPaidTotal >= grandTotal ? "PAID" : "PARTIAL";
      const changeAmount = newPaidTotal > grandTotal ? round2(newPaidTotal - grandTotal) : 0;

      const result = await tx.sale.update({
        where: { id: fresh.id },
        data: { paidTotal: newPaidTotal, status: newStatus, changeAmount },
        include: { payments: true },
      });

      // Jurnal pelunasan piutang: Debit Kas/Bank, Kredit Piutang Usaha. Hanya sebesar sisa piutang —
      // kelebihan bayar adalah kembalian ke pelanggan, bukan pendapatan/kas masuk.
      await postSalePaymentJournal(tx, {
        tenantId: user.tenantId,
        saleId: fresh.id,
        invoiceNo: fresh.invoiceNo,
        entryDate: new Date(),
        amount: Math.min(parsed.data.amount, outstandingBefore),
        method: parsed.data.method,
      });

      return result;
    });

    return NextResponse.json({ message: "Pembayaran berhasil ditambahkan", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    if ((err as { code?: string })?.code === "P2034") {
      return NextResponse.json({ message: "Terjadi konflik pembayaran paralel, silakan coba lagi", code: "CONCURRENT_UPDATE" }, { status: 409 });
    }
    console.error("add sale payment error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
