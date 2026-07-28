import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminFromRequest, AuthError } from "@/lib/auth";
import { TRIAL_DAYS } from "@/lib/subscription";
import { sendWhatsappMessage } from "@/lib/whatsapp";

const schema = z.object({
  price: z.number().min(0).optional(), // opsional, buat catat nominal yang diterima
  extendDays: z.number().int().positive().default(TRIAL_DAYS), // default perpanjang 30 hari
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = getAdminFromRequest(req);

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    const { price, extendDays } = parsed.success ? parsed.data : { price: undefined, extendDays: TRIAL_DAYS };

    const subscription = await prisma.subscription.findUnique({
      where: { id: params.id },
      include: { tenant: true },
    });
    if (!subscription) return NextResponse.json({ message: "Data langganan tidak ditemukan" }, { status: 404 });

    // Perpanjangan dihitung dari endDate lama kalau masih berlaku (renewal lebih awal,
    // sisa masa aktif tidak hangus), atau dari hari ini kalau sudah lewat (expired).
    const now = new Date();
    const currentEnd = new Date(subscription.endDate);
    const base = currentEnd > now ? currentEnd : now;
    const newEndDate = new Date(base);
    newEndDate.setDate(newEndDate.getDate() + extendDays);

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "ACTIVE",
        paymentStatus: "PAID",
        endDate: newEndDate,
        ...(price !== undefined ? { price } : {}),
        confirmedBy: admin.adminId,
        confirmedAt: now,
        paymentNote: null,
      },
    });

    if (subscription.tenant.phone) {
      const formattedDate = newEndDate.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
      sendWhatsappMessage(
        subscription.tenant.phone,
        `Halo ${subscription.tenant.ownerName}! 🎉\n\nPembayaran langganan toko *${subscription.tenant.businessName}* sudah kami konfirmasi.\n\nLangganan kamu aktif sampai *${formattedDate}*. Terima kasih!`
      ).catch((err) => console.error("Gagal kirim WhatsApp konfirmasi pembayaran:", err));
    }

    return NextResponse.json({ message: "Pembayaran berhasil dikonfirmasi, langganan diperpanjang.", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("confirm payment error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
