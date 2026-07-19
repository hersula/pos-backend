import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const warehouses = await prisma.warehouse.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ data: warehouses });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list warehouses error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const createSchema = z.object({ name: z.string().min(2) });

export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Nama gudang wajib diisi" }, { status: 400 });
    }

    const warehouse = await prisma.warehouse.create({
      data: { tenantId: user.tenantId, name: parsed.data.name },
    });

    return NextResponse.json({ message: "Gudang berhasil dibuat", data: warehouse }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("create warehouse error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
