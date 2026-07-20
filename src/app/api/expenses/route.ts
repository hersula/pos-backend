import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { postExpenseJournal } from "@/lib/accounting";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom") ?? undefined;
    const dateTo = searchParams.get("dateTo") ?? undefined;
    const category = searchParams.get("category") ?? undefined;

    const expenses = await prisma.expense.findMany({
      where: {
        tenantId: user.tenantId,
        ...(category ? { category } : {}),
        ...(dateFrom || dateTo
          ? {
              expenseDate: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo) } : {}),
              },
            }
          : {}),
      },
      orderBy: { expenseDate: "desc" },
    });

    const total = expenses.reduce((sum: number, e: (typeof expenses)[number]) => sum + Number(e.amount), 0);

    return NextResponse.json({ data: expenses, total: round2(total) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list expenses error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const createSchema = z.object({
  category: z.string().min(2, "Kategori beban wajib diisi"), // mis. "Listrik", "Sewa", "Gaji"
  amount: z.number().positive(),
  description: z.string().optional(),
  expenseDate: z.string(), // YYYY-MM-DD
});

export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "AKUNTAN"]);

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const { category, amount, description, expenseDate } = parsed.data;

    const expense = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newExpense = await tx.expense.create({
        data: {
          tenantId: user.tenantId,
          category,
          amount,
          description,
          expenseDate: new Date(expenseDate),
          createdBy: user.userId,
        },
      });

      // Jurnal otomatis: Debit Beban Operasional, Kredit Kas
      await postExpenseJournal(tx, {
        tenantId: user.tenantId,
        expenseId: newExpense.id,
        entryDate: new Date(expenseDate),
        amount,
        description: `Beban ${category}${description ? ` - ${description}` : ""}`,
      });

      return newExpense;
    });

    return NextResponse.json({ message: "Beban berhasil dicatat", data: expense }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("create expense error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
