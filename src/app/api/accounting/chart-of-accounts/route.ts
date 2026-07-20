import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const accounts = await prisma.chartOfAccount.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({ data: accounts });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list chart of accounts error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const createSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(2),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
});

export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "AKUNTAN"]);

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ message: "Data tidak valid" }, { status: 400 });

    const dup = await prisma.chartOfAccount.findFirst({ where: { tenantId: user.tenantId, code: parsed.data.code } });
    if (dup) return NextResponse.json({ message: "Kode akun sudah dipakai" }, { status: 409 });

    const account = await prisma.chartOfAccount.create({ data: { tenantId: user.tenantId, ...parsed.data } });
    return NextResponse.json({ message: "Akun berhasil dibuat", data: account }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("create chart of account error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
