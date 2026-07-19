import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { comparePassword, signAccessToken, signRefreshToken } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: "Email/password wajib diisi" }, { status: 400 });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findFirst({
      where: { email },
      include: { tenant: true },
    });

    if (!user || !(await comparePassword(password, user.password))) {
      return NextResponse.json({ message: "Email atau password salah" }, { status: 401 });
    }

    // Cek status tenant terlebih dahulu — ini inti dari rule approval
    if (user.tenant.status === "PENDING") {
      return NextResponse.json(
        {
          message: "Akun toko kamu masih menunggu persetujuan admin.",
          tenantStatus: "PENDING",
        },
        { status: 403 }
      );
    }

    if (user.tenant.status === "REJECTED") {
      return NextResponse.json(
        {
          message: `Pendaftaran toko ditolak. Alasan: ${user.tenant.rejectedReason ?? "-"}`,
          tenantStatus: "REJECTED",
        },
        { status: 403 }
      );
    }

    if (user.tenant.status === "SUSPENDED") {
      return NextResponse.json(
        { message: "Akun toko kamu sedang ditangguhkan. Hubungi admin.", tenantStatus: "SUSPENDED" },
        { status: 403 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json({ message: "Akun kamu tidak aktif. Hubungi pemilik toko." }, { status: 403 });
    }

    const payload = {
      type: "tenant_user" as const,
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    return NextResponse.json({
      message: "Login berhasil",
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenant: {
          id: user.tenant.id,
          businessName: user.tenant.businessName,
          planType: user.tenant.planType,
        },
      },
    });
  } catch (err) {
    console.error("login error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
