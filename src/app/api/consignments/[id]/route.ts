import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole } from "@/lib/auth";
import {
  ConsignError,
  assertStatus,
  handleConsignError,
  loadOrderOrThrow,
  lockOrder,
  orderBodySchema,
  parseBody,
  resolveOrderItems,
  serializeOrder,
  ensureConsignWarehouse,
} from "@/lib/consignment";

// ================= GET — detail (semua role tenant) =================
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    const order = await loadOrderOrThrow(prisma, user.tenantId, params.id);
    return NextResponse.json({ data: await serializeOrder(order, { detail: true }) });
  } catch (err) {
    return handleConsignError(err, "get consignment error");
  }
}

// ================= PUT — ubah dokumen DRAFT =================
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);
    const body = await parseBody(req, orderBodySchema);

    const existing = await loadOrderOrThrow(prisma, user.tenantId, params.id);
    assertStatus(existing, ["DRAFT"], "diubah");

    const customer = await prisma.customer.findFirst({ where: { id: body.customerId, tenantId: user.tenantId } });
    if (!customer) throw new ConsignError(404, "Pelanggan tidak ditemukan");
    const source = await prisma.warehouse.findFirst({ where: { id: body.sourceWarehouseId, tenantId: user.tenantId } });
    if (!source) throw new ConsignError(404, "Gudang asal tidak ditemukan");
    if (source.type !== "STORE") {
      throw new ConsignError(400, "Gudang asal harus gudang toko biasa", "INVALID_SOURCE_WAREHOUSE");
    }
    const items = await resolveOrderItems(user.tenantId, body.items);
    const consignWarehouse = await ensureConsignWarehouse(user.tenantId, customer);

    await prisma.$transaction(async (tx) => {
      await lockOrder(tx, user.tenantId, params.id);
      const fresh = await tx.consignmentOrder.findFirst({ where: { id: params.id, tenantId: user.tenantId } });
      if (!fresh) throw new ConsignError(404, "Konsinyasi tidak ditemukan");
      assertStatus(fresh, ["DRAFT"], "diubah");

      await tx.consignmentItem.deleteMany({ where: { consignmentOrderId: params.id } });
      await tx.consignmentOrder.update({
        where: { id: params.id },
        data: {
          customerId: customer.id,
          sourceWarehouseId: source.id,
          consignWarehouseId: consignWarehouse.id,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          note: body.note ?? null,
          items: { create: items },
        },
      });
    });

    const order = await loadOrderOrThrow(prisma, user.tenantId, params.id);
    return NextResponse.json({ message: "Konsinyasi berhasil diperbarui", data: await serializeOrder(order, { detail: true }) });
  } catch (err) {
    return handleConsignError(err, "update consignment error");
  }
}
