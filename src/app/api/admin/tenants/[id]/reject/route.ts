import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminFromRequest, AuthError } from "@/lib/auth";

const schema = z.object({
  reason: z.string().min(3, "Alasan penolakan wajib diisi"),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    getAdminFromRequest(req);

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Alasan penolakan wajib diisi" }, { status: 400 });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: params.id } });
    if (!tenant) {
      return NextResponse.json({ message: "Tenant tidak ditemukan" }, { status: 404 });
    }

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { status: "REJECTED", rejectedReason: parsed.data.reason },
    });

    // TODO: kirim email pemberitahuan penolakan ke pemilik toko

    return NextResponse.json({
      message: `Tenant "${updated.businessName}" ditolak.`,
      tenant: updated,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    console.error("reject tenant error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
