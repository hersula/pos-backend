import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminFromRequest, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    getAdminFromRequest(req);

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status"); // TRIAL | ACTIVE | PENDING_PAYMENT | EXPIRED | CANCELLED

    const subscriptions = await prisma.subscription.findMany({
      where: status ? { status: status as any } : undefined,
      include: { tenant: { select: { id: true, businessName: true, ownerName: true, email: true, phone: true } } },
      orderBy: { startDate: "desc" },
    });

    // Status EXPIRED itu turunan dari tanggal (bukan selalu tersimpan persis di DB kalau
    // belum pernah "disentuh"), jadi dihitung ulang di sini supaya daftar selalu akurat
    // walau baris subscription-nya belum pernah di-update sejak lewat endDate.
    const now = new Date();
    const withComputedStatus = subscriptions.map((sub) => {
      const isPastEnd = now > new Date(sub.endDate);
      const computedStatus = isPastEnd && sub.status !== "PENDING_PAYMENT" && sub.status !== "CANCELLED" ? "EXPIRED" : sub.status;
      const daysRemaining = Math.ceil((new Date(sub.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return { ...sub, computedStatus, daysRemaining };
    });

    const filtered = status ? withComputedStatus.filter((s) => s.computedStatus === status) : withComputedStatus;

    return NextResponse.json({ data: filtered });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list subscriptions error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
