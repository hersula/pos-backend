import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getAdminFromRequest, AuthError } from "@/lib/auth";
import { ACCOUNT_CODES } from "@/lib/accounting";

// Chart of accounts default yang otomatis dibuat saat tenant di-approve
const DEFAULT_ACCOUNTS = [
  { code: ACCOUNT_CODES.KAS, name: "Kas", type: "ASSET" as const },
  { code: ACCOUNT_CODES.BANK, name: "Bank", type: "ASSET" as const },
  { code: ACCOUNT_CODES.PIUTANG_USAHA, name: "Piutang Usaha", type: "ASSET" as const },
  { code: ACCOUNT_CODES.PERSEDIAAN, name: "Persediaan Barang", type: "ASSET" as const },
  { code: ACCOUNT_CODES.HUTANG_USAHA, name: "Hutang Usaha", type: "LIABILITY" as const },
  { code: ACCOUNT_CODES.PPN_KELUARAN, name: "PPN Keluaran (Hutang Pajak)", type: "LIABILITY" as const },
  { code: ACCOUNT_CODES.MODAL_PEMILIK, name: "Modal Pemilik", type: "EQUITY" as const },
  { code: ACCOUNT_CODES.PENDAPATAN_PENJUALAN, name: "Pendapatan Penjualan", type: "REVENUE" as const },
  { code: ACCOUNT_CODES.HPP, name: "Harga Pokok Penjualan (HPP)", type: "EXPENSE" as const },
  { code: ACCOUNT_CODES.BEBAN_OPERASIONAL, name: "Beban Operasional", type: "EXPENSE" as const },
];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = getAdminFromRequest(req);

    const tenant = await prisma.tenant.findUnique({ where: { id: params.id } });
    if (!tenant) {
      return NextResponse.json({ message: "Tenant tidak ditemukan" }, { status: 404 });
    }
    if (tenant.status === "APPROVED") {
      return NextResponse.json({ message: "Tenant sudah di-approve sebelumnya" }, { status: 409 });
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const approvedTenant = await tx.tenant.update({
        where: { id: tenant.id },
        data: {
          status: "APPROVED",
          approvedBy: admin.adminId,
          approvedAt: new Date(),
          rejectedReason: null,
        },
      });

      // Aktifkan user OWNER pertama milik tenant ini
      await tx.user.updateMany({
        where: { tenantId: tenant.id, role: "OWNER" },
        data: { isActive: true },
      });

      // Buat warehouse/toko pusat default
      const existingWarehouse = await tx.warehouse.findFirst({ where: { tenantId: tenant.id } });
      if (!existingWarehouse) {
        await tx.warehouse.create({
          data: { tenantId: tenant.id, name: "Toko Pusat" },
        });
      }

      // Buat Chart of Accounts default jika belum ada
      const existingAccounts = await tx.chartOfAccount.count({ where: { tenantId: tenant.id } });
      if (existingAccounts === 0) {
        await tx.chartOfAccount.createMany({
          data: DEFAULT_ACCOUNTS.map((acc) => ({ ...acc, tenantId: tenant.id })),
        });
      }

      return approvedTenant;
    });

    // TODO: kirim email aktivasi ke pemilik toko

    return NextResponse.json({
      message: `Tenant "${updated.businessName}" berhasil di-approve.`,
      tenant: updated,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    console.error("approve tenant error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
