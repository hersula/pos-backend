import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, AuthError } from "@/lib/auth";

// ================= GET — lookup produk lewat hasil scan barcode =================
// Dipakai Kasir & Pengadaan Barang: barcode yang discan bisa cocok dengan barcode
// satuan dasar produk (Product.barcode) ATAU barcode salah satu satuan tambahan
// (ProductUnit.barcode, mis. barcode kemasan "Dus"). Balikan selalu produk lengkap
// (termasuk daftar satuan), plus `matchedUnitId` kalau yang cocok adalah satuan
// tambahan (null kalau yang cocok barcode satuan dasar).
export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const code = new URL(req.url).searchParams.get("code")?.trim();
    if (!code) return NextResponse.json({ message: "Parameter code wajib diisi" }, { status: 400 });

    const product = await prisma.product.findFirst({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        OR: [{ barcode: code }, { units: { some: { barcode: code, isActive: true } } }],
      },
      include: {
        category: true,
        stocks: { include: { warehouse: true } },
        units: { where: { isActive: true }, orderBy: { conversionQty: "asc" } },
      },
    });

    if (!product) {
      return NextResponse.json({ message: `Produk dengan barcode "${code}" tidak ditemukan` }, { status: 404 });
    }

    const matchedUnit = product.barcode === code ? null : product.units.find((u) => u.barcode === code) ?? null;

    return NextResponse.json({ data: { product, matchedUnitId: matchedUnit?.id ?? null } });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("scan product barcode error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
