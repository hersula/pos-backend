import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

// Tipe akun yang saldo normalnya di sisi DEBIT (ASSET, EXPENSE) vs sisi KREDIT (LIABILITY, EQUITY, REVENUE)
const DEBIT_NORMAL_TYPES = ["ASSET", "EXPENSE"];

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "AKUNTAN"]);

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");
    const dateFrom = searchParams.get("dateFrom") ?? undefined;
    const dateTo = searchParams.get("dateTo") ?? undefined;

    if (!accountId) {
      return NextResponse.json({ message: "Parameter accountId wajib diisi" }, { status: 400 });
    }

    const account = await prisma.chartOfAccount.findFirst({ where: { id: accountId, tenantId: user.tenantId } });
    if (!account) return NextResponse.json({ message: "Akun tidak ditemukan" }, { status: 404 });

    const lines = await prisma.journalLine.findMany({
      where: {
        accountId,
        journalEntry: {
          tenantId: user.tenantId,
          ...(dateFrom || dateTo
            ? {
                entryDate: {
                  ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                  ...(dateTo ? { lte: new Date(dateTo) } : {}),
                },
              }
            : {}),
        },
      },
      include: { journalEntry: true },
      orderBy: { journalEntry: { entryDate: "asc" } },
    });

    const isDebitNormal = DEBIT_NORMAL_TYPES.includes(account.type);
    let runningBalance = 0;

    const rows = lines.map((line: (typeof lines)[number]) => {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      runningBalance += isDebitNormal ? debit - credit : credit - debit;

      return {
        journalEntryId: line.journalEntryId,
        date: line.journalEntry.entryDate,
        description: line.journalEntry.description,
        referenceType: line.journalEntry.referenceType,
        referenceId: line.journalEntry.referenceId,
        debit,
        credit,
        balance: round2(runningBalance),
      };
    });

    return NextResponse.json({
      account: { id: account.id, code: account.code, name: account.name, type: account.type },
      rows,
      endingBalance: round2(runningBalance),
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("ledger error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
