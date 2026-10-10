import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

// ================= GET — daftar level harga (master data, mis. "Grosir", "Member") =================
// Tidak termasuk "Umum"/default -- itu cukup Product.sellPrice, bukan baris di tabel ini.
export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);

    const priceLevels = await prisma.priceLevel.findMany({
      where: { tenantId: user.tenantId },
      include: { _count: { select: { prices: true } } },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ data: priceLevels });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list price levels error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().min(2, "Nama level harga minimal 2 karakter"),
});

export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const priceLevel = await prisma.priceLevel.create({
      data: { tenantId: user.tenantId, name: parsed.data.name },
    });

    return NextResponse.json({ message: "Level harga berhasil dibuat", data: priceLevel }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("create price level error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
