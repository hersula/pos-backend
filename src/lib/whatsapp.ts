import { prisma } from "@/lib/prisma";

const SETTING_KEY_DEVICE_ID = "whatsapp_device_id";
const SETTING_KEY_ENABLED = "whatsapp_enabled";

const DEFAULT_API_URL = "https://wa.sicerdiq.my.id/send/message";

async function getSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch (err) {
    console.error(`Gagal membaca pengaturan "${key}":`, err);
    return null;
  }
}

/**
 * Device ID diprioritaskan dari database (`platform_settings`, diedit lewat
 * Admin Panel → Pengaturan → WhatsApp) supaya bisa diganti admin kapan saja
 * tanpa perlu redeploy. Kalau belum pernah diset di database, jatuh ke
 * `WHATSAPP_DEVICE_ID` di `.env` sebagai default awal.
 */
export async function getWhatsappDeviceId(): Promise<string> {
  const fromDb = await getSetting(SETTING_KEY_DEVICE_ID);
  return fromDb ?? process.env.WHATSAPP_DEVICE_ID ?? "";
}

export async function isWhatsappEnabled(): Promise<boolean> {
  const fromDb = await getSetting(SETTING_KEY_ENABLED);
  if (fromDb !== null) return fromDb === "true";
  return (process.env.WHATSAPP_ENABLED ?? "true").toLowerCase() === "true";
}

/**
 * Normalisasi nomor telepon Indonesia ke format internasional tanpa "+"
 * (mis. "08123456789" atau "+628123456789" -> "628123456789"), format yang
 * umum diminta gateway WhatsApp seperti ini.
 */
export function formatPhoneNumber(phone: string): string {
  let digits = phone.replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) {
    digits = "62" + digits.slice(1);
  } else if (!digits.startsWith("62")) {
    digits = "62" + digits;
  }
  return digits;
}

/**
 * Kirim pesan WhatsApp lewat gateway. Sengaja TIDAK melempar error ke
 * pemanggil — kegagalan kirim notifikasi tidak boleh menggagalkan proses
 * utama (approve/reject tenant tetap harus sukses walau WA gagal terkirim).
 * Hasil sukses/gagalnya cukup di-log untuk keperluan debug.
 */
export async function sendWhatsappMessage(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
  try {
    const enabled = await isWhatsappEnabled();
    if (!enabled) {
      console.log("WhatsApp notification dinonaktifkan, skip kirim pesan.");
      return { success: false, error: "disabled" };
    }

    if (!phone) {
      return { success: false, error: "Nomor telepon kosong" };
    }

    const deviceId = await getWhatsappDeviceId();
    if (!deviceId) {
      console.warn("WHATSAPP_DEVICE_ID belum diatur (env maupun Admin Panel), notifikasi WA dilewati.");
      return { success: false, error: "Device ID belum diatur" };
    }

    const apiUrl = process.env.WHATSAPP_API_URL || DEFAULT_API_URL;
    const authUsername = process.env.WHATSAPP_AUTH_USERNAME || "";
    const authPassword = process.env.WHATSAPP_AUTH_PASSWORD || "";
    const formattedPhone = formatPhoneNumber(phone);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": deviceId,
        Authorization: "Basic " + Buffer.from(`${authUsername}:${authPassword}`).toString("base64"),
      },
      body: JSON.stringify({ phone: formattedPhone, message }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("Kirim WhatsApp gagal:", response.status, text);
      return { success: false, error: `Gateway membalas status ${response.status}` };
    }

    return { success: true };
  } catch (err) {
    console.error("Kirim WhatsApp error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------- Template pesan ----------

export function tenantApprovedMessage(params: { ownerName: string; businessName: string; email: string }) {
  const { ownerName, businessName, email } = params;
  return (
    `Halo ${ownerName}! 🎉\n\n` +
    `Selamat, pendaftaran toko *${businessName}* di aplikasi POS sudah *DISETUJUI* oleh tim kami.\n\n` +
    `Kamu sekarang bisa login menggunakan:\n` +
    `Email: ${email}\n\n` +
    `Silakan buka aplikasi dan mulai kelola toko kamu. Terima kasih!`
  );
}

export function tenantRejectedMessage(params: { ownerName: string; businessName: string; reason: string }) {
  const { ownerName, businessName, reason } = params;
  return (
    `Halo ${ownerName},\n\n` +
    `Mohon maaf, pendaftaran toko *${businessName}* di aplikasi POS belum bisa kami setujui.\n\n` +
    `Alasan: ${reason}\n\n` +
    `Silakan daftar ulang dengan data yang sesuai, atau hubungi tim kami kalau ada pertanyaan.`
  );
}

// ---------- Pengaturan (dipakai endpoint admin) ----------

export async function getWhatsappSettings() {
  const [deviceId, enabled] = await Promise.all([getWhatsappDeviceId(), isWhatsappEnabled()]);
  return {
    deviceId,
    enabled,
    apiUrl: process.env.WHATSAPP_API_URL || DEFAULT_API_URL,
    deviceIdSource: (await getSetting(SETTING_KEY_DEVICE_ID)) !== null ? "database" : "env",
  };
}

export async function updateWhatsappSettings(params: { deviceId?: string; enabled?: boolean }) {
  const ops = [];

  if (params.deviceId !== undefined) {
    ops.push(
      prisma.platformSetting.upsert({
        where: { key: SETTING_KEY_DEVICE_ID },
        create: { key: SETTING_KEY_DEVICE_ID, value: params.deviceId },
        update: { value: params.deviceId },
      })
    );
  }

  if (params.enabled !== undefined) {
    ops.push(
      prisma.platformSetting.upsert({
        where: { key: SETTING_KEY_ENABLED },
        create: { key: SETTING_KEY_ENABLED, value: String(params.enabled) },
        update: { value: String(params.enabled) },
      })
    );
  }

  await Promise.all(ops);
  return getWhatsappSettings();
}
