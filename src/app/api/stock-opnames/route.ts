import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole } from "@/lib/auth";
import {
  HEADER_INCLUDE,
  OPNAME_STATUSES,
  OpnameError,
  createSchema,
  assertNoDraft,
  generateOpnameNo,
  loadNames,
  handleOpnameError,
  parseBody,
  serializeHeader,
  serializeOpname,
  summarize,
} from "@/lib/stock-opname";

// GET — daftar sesi opname (semua role tenant)
export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? undefined;
    if (status && !(OPNAME_STATUSES as readonly string[]).includes(status)) throw new OpnameError(400, "Status tidak valid");
    const warehouseId = searchParams.get("warehouseId") ?? undefined;
    const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? 20) || 20));

    const where: Prisma.StockOpnameWhereInput = {
      tenantId: user.tenantId,
      ...(status ? { status: status as (typeof OPNAME_STATUSES)[number] } : {}),
      ...(warehouseId ? { warehouseId } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.stockOpname.findMany({ where, include: HEADER_INCLUDE, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.stockOpname.count({ where }),
    ]);
    const sums = await summarize(prisma, rows.map((r) => r.id));
    const names = await loadNames(prisma, rows);
    return NextResponse.json({
      data: rows.map((r) => serializeHeader(r, sums.get(r.id)!, names.get(r.id))),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    return handleOpnameError(err, "list stock opnames error");
  }
}

// POST — buat sesi + snapshot stok gudang (OWNER, MANAGER)
export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);
    const body = await parseBody(req, createSchema);

    const warehouse = await prisma.warehouse.findFirst({ where: { id: body.warehouseId, tenantId: user.tenantId } });
    if (!warehouse) throw new OpnameError(404, "Gudang tidak ditemukan");
    if (warehouse.type !== "STORE") {
      throw new OpnameError(400, "Gudang konsinyasi tidak bisa diopname", "CONSIGNMENT_WAREHOUSE");
    }
    if (body.categoryId) {
      const cat = await prisma.category.findFirst({ where: { id: body.categoryId, tenantId: user.tenantId } });
      if (!cat) throw new OpnameError(404, "Kategori tidak ditemukan");
    }

    let createdId: string | null = null;
    for (let attempt = 0; attempt < 3 && !createdId; attempt++) {
      try {
        createdId = await prisma.$transaction(
          async (tx) => {
            // Satu DRAFT per gudang: kunci baris gudang lalu cek di dalam transaksi (aman race)
            await assertNoDraft(tx, user.tenantId, warehouse.id);
            // Snapshot dibaca di dalam transaksi yang sama dengan pembuatan sesi
            const products = await tx.product.findMany({
              where: { tenantId: user.tenantId, isActive: true, ...(body.categoryId ? { categoryId: body.categoryId } : {}) },
              select: { id: true, costPrice: true },
            });
            if (products.length === 0) throw new OpnameError(400, "Tidak ada produk aktif untuk dihitung", "NO_PRODUCTS");
            const stocks = await tx.stock.findMany({
              where: { warehouseId: warehouse.id, productId: { in: products.map((p) => p.id) } },
              select: { productId: true, quantity: true },
            });
            const qtyMap = new Map(stocks.map((s) => [s.productId, s.quantity]));

            const opnameNo = await generateOpnameNo(tx, user.tenantId);
            const created = await tx.stockOpname.create({
              data: {
                tenantId: user.tenantId,
                opnameNo,
                warehouseId: warehouse.id,
                categoryId: body.categoryId,
                note: body.note,
                createdById: user.userId,
              },
              select: { id: true },
            });
            await tx.stockOpnameItem.createMany({
              data: products.map((p) => ({
                stockOpnameId: created.id,
                productId: p.id,
                systemQty: qtyMap.get(p.id) ?? 0,
                unitCost: p.costPrice,
              })),
            });
            return created.id;
          },
          { timeout: 60000, maxWait: 20000 }
        );
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") || attempt === 2) throw err;
      }
    }

    const opname = await prisma.stockOpname.findFirstOrThrow({ where: { id: createdId!, tenantId: user.tenantId }, include: HEADER_INCLUDE });
    return NextResponse.json({ message: "Sesi opname dibuat", data: await serializeOpname(prisma, opname, true) }, { status: 201 });
  } catch (err) {
    return handleOpnameError(err, "create stock opname error");
  }
}
