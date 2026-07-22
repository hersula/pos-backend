import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminFromRequest, AuthError } from "@/lib/auth";
import { getWhatsappSettings, updateWhatsappSettings, sendWhatsappMessage } from "@/lib/whatsapp";

export async function GET(req: NextRequest) {
  try {
    getAdminFromRequest(req);
    const settings = await getWhatsappSettings();
    return NextResponse.json({ data: settings });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("get whatsapp settings error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const schema = z.object({
  deviceId: z.string().min(1, "Device ID tidak boleh kosong").optional(),
  enabled: z.boolean().optional(),
  testPhone: z.string().optional(), // kalau diisi, langsung kirim pesan test ke nomor ini
});

export async function PUT(req: NextRequest) {
  try {
    const admin = getAdminFromRequest(req);
    if (admin.role !== "SUPER_ADMIN") {
      return NextResponse.json({ message: "Hanya Super Admin yang boleh mengubah pengaturan ini" }, { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const { deviceId, enabled, testPhone } = parsed.data;

    const settings = await updateWhatsappSettings({ deviceId, enabled });

    let testResult: { success: boolean; error?: string } | null = null;
    if (testPhone) {
      testResult = await sendWhatsappMessage(
        testPhone,
        "Ini pesan uji coba dari Admin Panel POS. Kalau kamu menerima ini, pengaturan WhatsApp sudah benar. ✅"
      );
    }

    return NextResponse.json({ message: "Pengaturan WhatsApp berhasil disimpan", data: settings, testResult });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("update whatsapp settings error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
