import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "AKUNTAN"]);

    const { searchParams } = new URL(req.url);
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1); // awal bulan ini
    const dateFrom = searchParams.get("dateFrom") ? new Date(searchParams.get("dateFrom")!) : defaultFrom;
    const dateTo = searchParams.get("dateTo") ? new Date(searchParams.get("dateTo")!) : now;

    // Ambil semua baris jurnal REVENUE dan EXPENSE (termasuk HPP) dalam rentang tanggal
    const lines = await prisma.journalLine.findMany({
      where: {
        journalEntry: {
          tenantId: user.tenantId,
          entryDate: { gte: dateFrom, lte: dateTo },
        },
        account: { type: { in: ["REVENUE", "EXPENSE"] } },
      },
      include: { account: true },
    });

    const byAccount = new Map<string, { code: string; name: string; type: string; amount: number }>();

    for (const line of lines) {
      const key = line.account.id;
      const existing = byAccount.get(key) ?? {
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
        amount: 0,
      };
      // REVENUE saldo normal di kredit, EXPENSE (termasuk HPP) saldo normal di debit
      const delta =
        line.account.type === "REVENUE" ? Number(line.credit) - Number(line.debit) : Number(line.debit) - Number(line.credit);
      existing.amount += delta;
      byAccount.set(key, existing);
    }

    const revenueAccounts = [...byAccount.values()].filter((a) => a.type === "REVENUE");
    const expenseAccounts = [...byAccount.values()].filter((a) => a.type === "EXPENSE");

    const totalRevenue = round2(revenueAccounts.reduce((s, a) => s + a.amount, 0));
    const hpp = expenseAccounts.find((a) => a.code === "5000");
    const totalCogs = round2(hpp?.amount ?? 0);
    const grossProfit = round2(totalRevenue - totalCogs);

    const operatingExpenses = expenseAccounts.filter((a) => a.code !== "5000");
    const totalOperatingExpenses = round2(operatingExpenses.reduce((s, a) => s + a.amount, 0));
    const netProfit = round2(grossProfit - totalOperatingExpenses);

    return NextResponse.json({
      period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      revenue: { accounts: revenueAccounts.map(round2Account), total: totalRevenue },
      costOfGoodsSold: totalCogs,
      grossProfit,
      operatingExpenses: { accounts: operatingExpenses.map(round2Account), total: totalOperatingExpenses },
      netProfit,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("profit-loss error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function round2Account(a: { code: string; name: string; amount: number }) {
  return { ...a, amount: round2(a.amount) };
}
