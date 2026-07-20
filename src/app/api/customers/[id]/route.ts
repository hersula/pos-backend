import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, AuthError } from "@/lib/auth";

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    const existing = await prisma.customer.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!existing) return NextResponse.json({ message: "Pelanggan tidak ditemukan" }, { status: 404 });

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ message: "Data tidak valid" }, { status: 400 });

    const updated = await prisma.customer.update({ where: { id: params.id }, data: parsed.data });
    return NextResponse.json({ message: "Pelanggan berhasil diperbarui", data: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("update customer error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    const existing = await prisma.customer.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!existing) return NextResponse.json({ message: "Pelanggan tidak ditemukan" }, { status: 404 });

    const saleCount = await prisma.sale.count({ where: { customerId: params.id } });
    if (saleCount > 0) {
      return NextResponse.json({ message: "Tidak bisa hapus pelanggan yang sudah punya riwayat transaksi" }, { status: 409 });
    }

    await prisma.customer.delete({ where: { id: params.id } });
    return NextResponse.json({ message: "Pelanggan berhasil dihapus" });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("delete customer error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
