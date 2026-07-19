import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminFromRequest, AuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    getAdminFromRequest(req); // hanya admin platform yang boleh akses

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status"); // PENDING | APPROVED | REJECTED | SUSPENDED
    const search = searchParams.get("search") ?? undefined;

    const tenants = await prisma.tenant.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(search
          ? {
              OR: [
                { businessName: { contains: search } },
                { email: { contains: search } },
                { ownerName: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { subscriptions: true },
    });

    return NextResponse.json({ data: tenants });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    console.error("list tenants error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
