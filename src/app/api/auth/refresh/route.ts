import { NextRequest, NextResponse } from "next/server";
import { verifyRefreshToken, signAccessToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSubscriptionAccessStatus } from "@/lib/subscription";

export async function POST(req: NextRequest) {
  try {
    const { refreshToken } = await req.json();
    if (!refreshToken) {
      return NextResponse.json({ message: "refreshToken wajib diisi" }, { status: 400 });
    }

    const payload = verifyRefreshToken(refreshToken);
    const { iat, exp, ...cleanPayload } = payload as any;

    // Re-validasi status tenant & langganan tiap kali refresh — bukan cuma
    // percaya isi JWT lama. Ini yang bikin "sistem off" beneran berlaku di
    // tengah sesi: begitu trial/langganan habis, refresh berikutnya ditolak
    // walau access token sebelumnya masih hidup, tanpa perlu tunggu logout manual.
    if (cleanPayload.type === "tenant_user") {
      const tenant = await prisma.tenant.findUnique({ where: { id: cleanPayload.tenantId } });
      if (!tenant || tenant.status !== "APPROVED") {
        return NextResponse.json({ message: "Sesi tidak valid, silakan login ulang." }, { status: 401 });
      }
      if (tenant.planType === "SUBSCRIBE") {
        const access = await getSubscriptionAccessStatus(tenant.id);
        if (!access.allowed) {
          return NextResponse.json(
            { message: access.reason ?? "Langganan sudah tidak aktif.", tenantStatus: "SUBSCRIPTION_EXPIRED" },
            { status: 401 }
          );
        }
      }
    }

    const accessToken = signAccessToken(cleanPayload);
    return NextResponse.json({ accessToken });
  } catch (err) {
    return NextResponse.json({ message: "Refresh token tidak valid atau kadaluarsa" }, { status: 401 });
  }
}
