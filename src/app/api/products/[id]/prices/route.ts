import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";

// GET /api/products/:id/prices — matriks harga (satuan dasar + satuan turunan) x level harga
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);

    const product = await prisma.product.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: { units: true },
    });
    if (!product) return NextResponse.json({ message: "Produk tidak ditemukan" }, { status: 404 });

    const [priceLevels, prices] = await Promise.all([
      prisma.priceLevel.findMany({ where: { tenantId: user.tenantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      prisma.productPrice.findMany({ where: { productId: params.id } }),
    ]);

    return NextResponse.json({
      data: {
        defaultSellPrice: product.sellPrice,
        baseUnit: { id: null, name: product.unit, conversionQty: 1 },
        units: product.units,
        priceLevels,
        prices, // { productUnitId: string|null, priceLevelId, price }[]
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("list product prices error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

// PUT /api/products/:id/prices — upsert satu atau lebih harga sekaligus (mis. simpan seluruh matriks dari form)
const priceEntrySchema = z.object({
  productUnitId: z.string().nullable().optional(), // null/undefined = satuan dasar produk
  priceLevelId: z.string(),
  price: z.number().min(0),
});

const putSchema = z.object({
  prices: z.array(priceEntrySchema).min(1, "Minimal 1 entri harga"),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);

    const product = await prisma.product.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
    if (!product) return NextResponse.json({ message: "Produk tidak ditemukan" }, { status: 404 });

    const parsed = putSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    // Validasi productUnitId & priceLevelId milik produk/tenant ini
    const unitIds = parsed.data.prices.map((p) => p.productUnitId).filter((v): v is string => !!v);
    const levelIds = [...new Set(parsed.data.prices.map((p) => p.priceLevelId))];

    const [validUnits, validLevels] = await Promise.all([
      unitIds.length
        ? prisma.productUnit.findMany({ where: { id: { in: unitIds }, productId: product.id } })
        : Promise.resolve([]),
      prisma.priceLevel.findMany({ where: { id: { in: levelIds }, tenantId: user.tenantId } }),
    ]);
    const validUnitIds = new Set(validUnits.map((u) => u.id));
    const validLevelIds = new Set(validLevels.map((l) => l.id));

    for (const entry of parsed.data.prices) {
      if (entry.productUnitId && !validUnitIds.has(entry.productUnitId)) {
        return NextResponse.json({ message: `Satuan ${entry.productUnitId} tidak valid untuk produk ini` }, { status: 400 });
      }
      if (!validLevelIds.has(entry.priceLevelId)) {
        return NextResponse.json({ message: `Level harga ${entry.priceLevelId} tidak ditemukan` }, { status: 400 });
      }
    }

    // MySQL memperlakukan NULL sebagai tidak sama dengan NULL di unique index, jadi
    // upsert lewat compound unique Prisma hanya aman dipakai untuk satuan turunan
    // (productUnitId terisi). Untuk harga satuan dasar (productUnitId null) kita
    // cari manual lalu update/insert supaya tidak membuat baris duplikat.
    await prisma.$transaction(async (tx) => {
      for (const entry of parsed.data.prices) {
        if (entry.productUnitId) {
          await tx.productPrice.upsert({
            where: { productUnitId_priceLevelId: { productUnitId: entry.productUnitId, priceLevelId: entry.priceLevelId } },
            update: { price: entry.price },
            create: {
              productId: product.id,
              productUnitId: entry.productUnitId,
              priceLevelId: entry.priceLevelId,
              price: entry.price,
            },
          });
        } else {
          const existing = await tx.productPrice.findFirst({
            where: { productId: product.id, productUnitId: null, priceLevelId: entry.priceLevelId },
          });
          if (existing) {
            await tx.productPrice.update({ where: { id: existing.id }, data: { price: entry.price } });
          } else {
            await tx.productPrice.create({
              data: { productId: product.id, productUnitId: null, priceLevelId: entry.priceLevelId, price: entry.price },
            });
          }
        }
      }
    });

    const prices = await prisma.productPrice.findMany({ where: { productId: product.id } });
    return NextResponse.json({ message: "Harga berhasil disimpan", data: prices });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("upsert product prices error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
