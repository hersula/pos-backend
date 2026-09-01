import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, hashPassword, AuthError } from "@/lib/auth";

const ROLE_VALUES = ["OWNER", "MANAGER", "KASIR", "GUDANG", "AKUNTAN"] as const;

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);

    const users = await prisma.user.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ data: users });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list users error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  email: z.string().email("Email tidak valid"),
  phone: z.string().optional(),
  password: z.string().min(6, "Password minimal 6 karakter"),
  role: z.enum(ROLE_VALUES),
});

export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER"]);

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const { name, email, phone, password, role } = parsed.data;

    const existing = await prisma.user.findFirst({ where: { tenantId: user.tenantId, email } });
    if (existing) {
      return NextResponse.json({ message: "Email sudah dipakai user lain di toko ini" }, { status: 409 });
    }

    const created = await prisma.user.create({
      data: { tenantId: user.tenantId, name, email, phone, password: await hashPassword(password), role, isActive: true },
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true },
    });

    return NextResponse.json({ message: "User berhasil ditambahkan", data: created }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("create user error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
