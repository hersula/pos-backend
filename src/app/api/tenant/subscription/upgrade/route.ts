import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { createTrialSubscription } from "@/lib/subscription";

// Self-service upgrade — pemilik toko FREE bisa upgrade sendiri tanpa perlu
// persetujuan admin lagi (tenant-nya kan sudah APPROVED sejak awal), langsung
// dapat masa coba (trial) 30 hari untuk paket Berlangganan.
export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER"]);

    const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
    if (!tenant) return NextResponse.json({ message: "Tenant tidak ditemukan" }, { status: 404 });

    if (tenant.planType === "SUBSCRIBE") {
      return NextResponse.json({ message: "Toko kamu sudah memakai paket Berlangganan" }, { status: 409 });
    }

    const subscription = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.tenant.update({ where: { id: tenant.id }, data: { planType: "SUBSCRIBE" } });
      return createTrialSubscription(tenant.id, "Trial", tx);
    });

    return NextResponse.json({
      message: "Berhasil upgrade ke paket Berlangganan! Masa coba gratis 30 hari sudah mulai berjalan.",
      data: subscription,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("upgrade subscription error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
