import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof prisma;

export const FREE_DAILY_TRANSACTION_LIMIT = 10;
export const TRIAL_DAYS = 30;

/**
 * Ambil subscription "aktif" milik tenant — karena renewal MENGUPDATE baris
 * yang sama (bukan bikin baris baru tiap siklus), setiap tenant SUBSCRIBE
 * cuma pernah punya maksimal 1 baris subscription sepanjang waktu.
 */
export async function getTenantSubscription(tenantId: string) {
  return prisma.subscription.findFirst({
    where: { tenantId },
    orderBy: { startDate: "desc" },
  });
}

/**
 * Menentukan apakah tenant SUBSCRIBE masih boleh mengakses aplikasi.
 * Tenant FREE selalu boleh login (batasannya di jumlah transaksi harian,
 * bukan di akses login) — lihat [checkFreeTransactionLimit].
 */
export async function getSubscriptionAccessStatus(tenantId: string): Promise<{
  allowed: boolean;
  reason?: string;
  daysRemaining?: number;
  subscription?: Awaited<ReturnType<typeof getTenantSubscription>>;
}> {
  const subscription = await getTenantSubscription(tenantId);

  if (!subscription) {
    // Tenant SUBSCRIBE tapi belum ada baris subscription sama sekali (seharusnya tidak
    // terjadi kalau alur registrasi/upgrade jalan normal) -> anggap belum bisa akses.
    return { allowed: false, reason: "Data langganan tidak ditemukan. Hubungi admin." };
  }

  const now = new Date();
  const endDate = new Date(subscription.endDate);
  const isWithinPeriod = now <= endDate;
  const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (isWithinPeriod) {
    return { allowed: true, daysRemaining, subscription };
  }

  // Sudah lewat endDate. Kalau pembayaran perpanjangan sudah dikonfirmasi admin SEBELUM
  // baris ini dicek lagi, endDate seharusnya sudah ke-update (lihat confirmPayment) —
  // jadi kalau masih lewat endDate di titik ini, berarti memang belum bayar/dikonfirmasi.
  return {
    allowed: false,
    reason:
      subscription.status === "PENDING_PAYMENT"
        ? "Masa langganan sudah berakhir. Pembayaran perpanjangan kamu sedang menunggu konfirmasi admin."
        : "Masa coba gratis (trial) atau langganan kamu sudah berakhir. Silakan hubungi admin untuk melanjutkan.",
    daysRemaining: 0,
    subscription,
  };
}

/**
 * Cek kuota transaksi harian untuk tenant FREE. Menghitung SEMUA baris sale
 * yang dibuat hari ini (apapun statusnya) supaya tidak bisa disiasati dengan
 * cara batal-buat-ulang.
 */
export async function checkFreeTransactionLimit(tenantId: string): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
}> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const used = await prisma.sale.count({
    where: { tenantId, createdAt: { gte: startOfDay, lt: endOfDay } },
  });

  return { allowed: used < FREE_DAILY_TRANSACTION_LIMIT, used, limit: FREE_DAILY_TRANSACTION_LIMIT };
}

/**
 * Buat subscription trial 30 hari baru untuk tenant (dipanggil saat registrasi
 * dengan planType SUBSCRIBE, maupun saat tenant FREE upgrade ke SUBSCRIBE).
 */
export async function createTrialSubscription(tenantId: string, planName = "Trial", db: DbClient = prisma) {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + TRIAL_DAYS);

  return db.subscription.create({
    data: {
      tenantId,
      planName,
      price: 0,
      billingCycle: "MONTHLY",
      startDate: start,
      endDate: end,
      status: "TRIAL",
      paymentStatus: "UNPAID",
    },
  });
}
