import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") ?? undefined;

    const customers = await prisma.customer.findMany({
      where: {
        tenantId: user.tenantId,
        ...(search
          ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }] }
          : {}),
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ data: customers });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list customers error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().min(2),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ message: "Data tidak valid" }, { status: 400 });

    const customer = await prisma.customer.create({ data: { tenantId: user.tenantId, ...parsed.data } });
    return NextResponse.json({ message: "Pelanggan berhasil dibuat", data: customer }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("create customer error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
