import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { hashPassword } from "@/lib/auth";
import { createTrialSubscription } from "@/lib/subscription";

const registerSchema = z.object({
  businessName: z.string().min(3, "Nama usaha minimal 3 karakter"),
  ownerName: z.string().min(3, "Nama pemilik minimal 3 karakter"),
  email: z.string().email("Email tidak valid"),
  phone: z.string().optional(),
  address: z.string().optional(),
  password: z.string().min(6, "Password minimal 6 karakter"),
  planType: z.enum(["FREE", "SUBSCRIBE"]),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { businessName, ownerName, email, phone, address, password, planType } = parsed.data;

    const existing = await prisma.tenant.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { message: "Email sudah terdaftar sebagai tenant" },
        { status: 409 }
      );
    }

    const hashedPassword = await hashPassword(password);

    // Buat tenant (status PENDING) + user OWNER pertama dalam satu transaksi
    const tenant = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newTenant = await tx.tenant.create({
        data: {
          businessName,
          ownerName,
          email,
          phone,
          address,
          planType,
          status: "PENDING",
        },
      });

      await tx.user.create({
        data: {
          tenantId: newTenant.id,
          name: ownerName,
          email,
          phone,
          password: hashedPassword,
          role: "OWNER",
          isActive: false, // aktif setelah tenant di-approve admin
        },
      });

      // Jika pilih SUBSCRIBE, langsung mulai masa coba gratis (trial) 30 hari.
      // Setelah trial habis, tenant tetap harus di-approve admin dulu (seperti FREE)
      // baru bisa login; begitu di-approve, hitung mundur trial-nya sudah berjalan.
      if (planType === "SUBSCRIBE") {
        await createTrialSubscription(newTenant.id, "Trial", tx);
      }

      return newTenant;
    });

    // TODO: kirim email notifikasi ke admin platform & konfirmasi ke pemilik toko

    return NextResponse.json(
      {
        message:
          planType === "FREE"
            ? "Registrasi berhasil. Menunggu persetujuan admin."
            : "Registrasi berhasil. Silakan lanjutkan pembayaran, akun tetap menunggu persetujuan admin.",
        tenant: {
          id: tenant.id,
          businessName: tenant.businessName,
          status: tenant.status,
          planType: tenant.planType,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("register-tenant error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
