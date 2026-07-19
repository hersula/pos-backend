import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const suppliers = await prisma.supplier.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ data: suppliers });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list suppliers error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().min(2),
  phone: z.string().optional(),
  address: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER", "GUDANG"]);

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ message: "Data tidak valid" }, { status: 400 });

    const supplier = await prisma.supplier.create({ data: { tenantId: user.tenantId, ...parsed.data } });
    return NextResponse.json({ message: "Supplier berhasil dibuat", data: supplier }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("create supplier error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
