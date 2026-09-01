import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, hashPassword, AuthError } from "@/lib/auth";

const ROLE_VALUES = ["OWNER", "MANAGER", "KASIR", "GUDANG", "AKUNTAN"] as const;

async function findOwned(id: string, tenantId: string) {
  const user = await prisma.user.findFirst({ where: { id, tenantId } });
  if (!user) throw new AuthError("User tidak ditemukan", 404);
  return user;
}

// Cegah toko kehilangan OWNER aktif terakhirnya (baik lewat ganti role maupun nonaktifkan).
async function assertNotLastActiveOwner(tenantId: string, excludingUserId: string) {
  const otherActiveOwners = await prisma.user.count({
    where: { tenantId, role: "OWNER", isActive: true, id: { not: excludingUserId } },
  });
  if (otherActiveOwners === 0) {
    throw new AuthError("Tidak bisa mengubah/menonaktifkan Pemilik (OWNER) terakhir yang aktif di toko ini", 409);
  }
}

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  role: z.enum(ROLE_VALUES).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER"]);
    const target = await findOwned(params.id, user.tenantId);

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const { name, phone, role, isActive, password } = parsed.data;

    if (target.role === "OWNER") {
      const losesOwnerRole = role !== undefined && role !== "OWNER";
      const getsDeactivated = isActive === false;
      if (losesOwnerRole || getsDeactivated) {
        await assertNotLastActiveOwner(user.tenantId, target.id);
      }
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(role !== undefined && { role }),
        ...(isActive !== undefined && { isActive }),
        ...(password !== undefined && { password: await hashPassword(password) }),
      },
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true },
    });

    return NextResponse.json({ message: "User berhasil diperbarui", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("update user error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER"]);
    const target = await findOwned(params.id, user.tenantId);

    if (target.role === "OWNER") {
      await assertNotLastActiveOwner(user.tenantId, target.id);
    }

    await prisma.user.update({ where: { id: target.id }, data: { isActive: false } });
    return NextResponse.json({ message: "User berhasil dinonaktifkan" });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("deactivate user error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
