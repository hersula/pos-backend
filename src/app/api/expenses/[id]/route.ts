import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { reverseJournalForReference } from "@/lib/accounting";

// Beban tidak diedit langsung (supaya jejak akunting tidak "menghilang") — untuk koreksi,
// hapus (otomatis membuat jurnal balik) lalu catat ulang dengan data yang benar.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "AKUNTAN"]);

    const expense = await prisma.expense.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!expense) return NextResponse.json({ message: "Data beban tidak ditemukan" }, { status: 404 });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await reverseJournalForReference(tx, {
        tenantId: user.tenantId,
        referenceType: "EXPENSE",
        referenceId: expense.id,
        entryDate: new Date(),
        description: `Koreksi/hapus beban: ${expense.category}`,
      });

      await tx.expense.delete({ where: { id: expense.id } });
    });

    return NextResponse.json({ message: "Beban berhasil dihapus (jurnal balik otomatis dibuat)" });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("delete expense error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
