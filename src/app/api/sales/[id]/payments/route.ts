import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

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
      await tx.salePayment.create({
        data: { saleId: sale.id, method: parsed.data.method, amount: parsed.data.amount, referenceNo: parsed.data.referenceNo },
      });

      const newPaidTotal = Number(sale.paidTotal) + parsed.data.amount;
      const grandTotal = Number(sale.grandTotal);
      const newStatus = newPaidTotal >= grandTotal ? "PAID" : "PARTIAL";
      const changeAmount = newPaidTotal > grandTotal ? newPaidTotal - grandTotal : 0;

      return tx.sale.update({
        where: { id: sale.id },
        data: { paidTotal: newPaidTotal, status: newStatus, changeAmount },
        include: { payments: true },
      });
    });

    return NextResponse.json({ message: "Pembayaran berhasil ditambahkan", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("add sale payment error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
