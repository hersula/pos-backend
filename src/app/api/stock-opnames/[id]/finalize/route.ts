import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole } from "@/lib/auth";
import { adjustStock, StockInsufficientError } from "@/lib/inventory";
import {
  OpnameError,
  assertDraft,
  finalizeSchema,
  handleOpnameError,
  loadOpnameOrThrow,
  lockOpname,
  serializeOpname,
} from "@/lib/stock-opname";

// POST — finalisasi: satu transaksi atomik. Menerapkan SELISIH RELATIF (diff) ke stok saat ini,
// sehingga transaksi yang terjadi setelah snapshot tidak tertimpa. OWNER, MANAGER.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);

    let raw: unknown = {};
    const text = await req.text();
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        throw new OpnameError(400, "Body request harus berupa JSON yang valid");
      }
    }
    const parsed = finalizeSchema.safeParse(raw ?? {});
    if (!parsed.success)
      throw new OpnameError(
        400,
        "Data tidak valid",
        "VALIDATION_ERROR",
        parsed.error.flatten().fieldErrors,
      );
    const clampToZero = parsed.data.clampToZero === true;

    const result = await prisma.$transaction(
      async (tx) => {
        await lockOpname(tx, user.tenantId, params.id);
        const opname = await loadOpnameOrThrow(tx, user.tenantId, params.id);
        assertDraft(opname, "difinalisasi");

        const items = await tx.stockOpnameItem.findMany({
          where: { stockOpnameId: opname.id },
          include: { product: { select: { name: true } } },
        });
        const counted = items.filter((i) => i.countedQty !== null);
        if (counted.length === 0)
          throw new OpnameError(
            400,
            "Belum ada item yang dihitung",
            "NO_COUNTED_ITEMS",
          );

        // Kunci baris stok agar tidak terkuras transaksi lain di antara pembacaan dan penulisan
        await tx.$queryRaw`SELECT id FROM stocks WHERE warehouse_id = ${opname.warehouseId} AND product_id IN (${Prisma.join(counted.map((i) => i.productId))}) FOR UPDATE`;
        const stocks = await tx.stock.findMany({
          where: {
            warehouseId: opname.warehouseId,
            productId: { in: counted.map((i) => i.productId) },
          },
          select: { productId: true, quantity: true },
        });
        const current = new Map(stocks.map((s) => [s.productId, s.quantity]));

        // Pass 1: hitung selisih yang diterapkan, deteksi konflik (hasil < 0) sebelum menulis apa pun
        const plan = counted.map((i) => {
          const cur = current.get(i.productId) ?? 0;
          let applied = i.diff;
          let clamped = false;
          if (cur + applied < 0) {
            if (clampToZero) {
              applied = -cur;
              clamped = true;
            }
          }
          return {
            item: i,
            cur,
            applied,
            conflict: cur + applied < 0,
            clamped,
          };
        });
        const conflicts = plan.filter((p) => p.conflict);
        if (conflicts.length > 0) {
          throw new OpnameError(
            409,
            "Stok saat ini berubah sejak snapshot sehingga penyesuaian membuat stok negatif. Cek ulang hitungan atau finalisasi dengan clampToZero.",
            "STOCK_CONFLICT",
            {
              items: conflicts.map((p) => ({
                itemId: p.item.id,
                productId: p.item.productId,
                productName: p.item.product.name,
                currentQty: p.cur,
                diff: p.item.diff,
              })),
            },
          );
        }

        // Pass 2: tulis
        let adjusted = 0;
        let clampedItems = 0;
        for (const p of plan) {
          if (p.applied !== 0) {
            try {
              await adjustStock(tx, {
                tenantId: user.tenantId,
                productId: p.item.productId,
                warehouseId: opname.warehouseId,
                type: "ADJUSTMENT",
                qty: Math.abs(p.applied),
                direction: p.applied > 0 ? 1 : -1,
                referenceType: "STOCK_OPNAME",
                referenceId: opname.id,
                note: `Stok opname ${opname.opnameNo}`,
                createdBy: user.userId,
              });
            } catch (e) {
              if (e instanceof StockInsufficientError) {
                throw new OpnameError(
                  409,
                  "Stok berubah saat finalisasi sehingga hasil negatif. Cek ulang hitungan atau finalisasi dengan clampToZero.",
                  "STOCK_CONFLICT",
                  {
                    items: [
                      {
                        itemId: p.item.id,
                        productId: p.item.productId,
                        productName: p.item.product.name,
                        currentQty: p.cur,
                        diff: p.item.diff,
                      },
                    ],
                  },
                );
              }
              throw e;
            }
            adjusted++;
          }
          if (p.clamped) clampedItems++;
          await tx.stockOpnameItem.update({
            where: { id: p.item.id },
            data: { stockBeforeFinalize: p.cur, appliedDiff: p.applied },
          });
        }

        await tx.stockOpname.update({
          where: { id: opname.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            completedById: user.userId,
          },
        });
        return {
          adjustedItems: adjusted,
          // clamped (mis. stok sudah 0) bukan "unchanged": dihitung di clampedItems
          unchangedItems: plan.filter((p) => !p.clamped && p.applied === 0)
            .length,
          uncountedItems: items.length - counted.length,
          clampedItems,
        };
      },
      { timeout: 120000, maxWait: 20000 },
    );

    const opname = await loadOpnameOrThrow(prisma, user.tenantId, params.id);
    return NextResponse.json({
      message: "Stok opname difinalisasi",
      data: await serializeOpname(prisma, opname, true),
      result,
    });
  } catch (err) {
    return handleOpnameError(err, "finalize stock opname error");
  }
}
