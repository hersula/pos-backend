import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { getTenantSubscription } from "@/lib/subscription";

const schema = z.object({
  note: z.string().optional(), // mis. "Sudah transfer ke rekening BCA, bukti terlampir via WA"
});

// Owner mengajukan "saya sudah/mau bayar perpanjangan" — tidak langsung
// mengaktifkan apapun (belum ada payment gateway terhubung), cuma menandai
// status jadi PENDING_PAYMENT supaya muncul di daftar Admin Panel untuk
// dikonfirmasi manual. Owner tetap bisa mengajukan ini walau masih trial
// (belum expired) untuk minta diperpanjang lebih awal, atau setelah expired.
export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER"]);

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    const note = parsed.success ? parsed.data.note : undefined;

    const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { planType: true } });
    if (tenant?.planType !== "SUBSCRIBE") {
      return NextResponse.json({ message: "Fitur ini hanya untuk tenant paket Berlangganan" }, { status: 409 });
    }

    const subscription = await getTenantSubscription(user.tenantId);
    if (!subscription) {
      return NextResponse.json({ message: "Data langganan tidak ditemukan" }, { status: 404 });
    }
    if (subscription.status === "PENDING_PAYMENT") {
      return NextResponse.json({ message: "Pengajuan pembayaran sebelumnya masih menunggu konfirmasi admin" }, { status: 409 });
    }

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: "PENDING_PAYMENT", paymentNote: note, paymentRequestedAt: new Date() },
    });

    return NextResponse.json({
      message: "Pengajuan pembayaran berhasil dikirim. Tim kami akan konfirmasi secepatnya.",
      data: updated,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("request payment error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
