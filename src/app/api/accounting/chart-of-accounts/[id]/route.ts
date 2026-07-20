import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { ACCOUNT_CODES } from "@/lib/accounting";

const DEFAULT_CODES: string[] = Object.values(ACCOUNT_CODES);

const updateSchema = z.object({ name: z.string().min(2) });

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "AKUNTAN"]);

    const account = await prisma.chartOfAccount.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!account) return NextResponse.json({ message: "Akun tidak ditemukan" }, { status: 404 });

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ message: "Data tidak valid" }, { status: 400 });

    const updated = await prisma.chartOfAccount.update({ where: { id: params.id }, data: { name: parsed.data.name } });
    return NextResponse.json({ message: "Akun berhasil diperbarui", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("update chart of account error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "AKUNTAN"]);

    const account = await prisma.chartOfAccount.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!account) return NextResponse.json({ message: "Akun tidak ditemukan" }, { status: 404 });

    if (DEFAULT_CODES.includes(account.code)) {
      return NextResponse.json(
        { message: "Akun default sistem tidak boleh dihapus karena dipakai oleh jurnal otomatis" },
        { status: 409 }
      );
    }

    const lineCount = await prisma.journalLine.count({ where: { accountId: account.id } });
    if (lineCount > 0) {
      return NextResponse.json({ message: "Tidak bisa hapus akun yang sudah punya histori jurnal" }, { status: 409 });
    }

    await prisma.chartOfAccount.delete({ where: { id: account.id } });
    return NextResponse.json({ message: "Akun berhasil dihapus" });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("delete chart of account error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
