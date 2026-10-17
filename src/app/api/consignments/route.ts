import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole } from "@/lib/auth";
import {
  ConsignError,
  ORDER_INCLUDE,
  ensureConsignWarehouse,
  generateConsignmentNo,
  handleConsignError,
  orderBodySchema,
  parseBody,
  resolveOrderItems,
  serializeOrder,
} from "@/lib/consignment";

const STATUSES = ["DRAFT", "SENT", "PARTIALLY_SETTLED", "SETTLED", "CANCELLED"] as const;

// ================= GET — daftar konsinyasi (semua role tenant) =================
export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    const { searchParams } = new URL(req.url);

    const status = searchParams.get("status") ?? undefined;
    if (status && !(STATUSES as readonly string[]).includes(status)) {
      throw new ConsignError(400, "Status tidak valid");
    }
    const customerId = searchParams.get("customerId") ?? undefined;
    const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? 20) || 20));

    const where: Prisma.ConsignmentOrderWhereInput = {
      tenantId: user.tenantId,
      ...(status ? { status: status as (typeof STATUSES)[number] } : {}),
      ...(customerId ? { customerId } : {}),
    };

    const [orders, total] = await Promise.all([
      prisma.consignmentOrder.findMany({
        where,
        include: { ...ORDER_INCLUDE, settlements: false },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.consignmentOrder.count({ where }),
    ]);

    // List hanya header + summary (tanpa items/settlements)
    const data = await Promise.all(
      orders.map(async (o) => {
        const { items, settlements, ...header } = (await serializeOrder({ ...o, settlements: [] }, { detail: false })) as any;
        return header;
      })
    );

    return NextResponse.json({ data, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
  } catch (err) {
    return handleConsignError(err, "list consignments error");
  }
}

// ================= POST — buat dokumen DRAFT =================
export async function POST(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);
    const body = await parseBody(req, orderBodySchema);

    // Semua ID dari klien harus milik tenant yang sama
    const customer = await prisma.customer.findFirst({ where: { id: body.customerId, tenantId: user.tenantId } });
    if (!customer) throw new ConsignError(404, "Pelanggan tidak ditemukan");

    const source = await prisma.warehouse.findFirst({ where: { id: body.sourceWarehouseId, tenantId: user.tenantId } });
    if (!source) throw new ConsignError(404, "Gudang asal tidak ditemukan");
    if (source.type !== "STORE") {
      throw new ConsignError(400, "Gudang asal harus gudang toko biasa", "INVALID_SOURCE_WAREHOUSE");
    }

    const items = await resolveOrderItems(user.tenantId, body.items);
    const consignWarehouse = await ensureConsignWarehouse(user.tenantId, customer);

    let createdId: string | null = null;
    for (let attempt = 0; attempt < 3 && !createdId; attempt++) {
      try {
        createdId = await prisma.$transaction(async (tx) => {
          const consignmentNo = await generateConsignmentNo(tx, user.tenantId);
          const created = await tx.consignmentOrder.create({
            data: {
              tenantId: user.tenantId,
              consignmentNo,
              customerId: customer.id,
              sourceWarehouseId: source.id,
              consignWarehouseId: consignWarehouse.id,
              dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
              note: body.note,
              createdById: user.userId,
              items: { create: items },
            },
            select: { id: true },
          });
          return created.id;
        });
      } catch (err) {
        // Nomor ganda akibat dua request bersamaan: ulangi dengan nomor berikutnya
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") || attempt === 2) throw err;
      }
    }

    const order = await prisma.consignmentOrder.findFirstOrThrow({ where: { id: createdId!, tenantId: user.tenantId }, include: ORDER_INCLUDE });
    return NextResponse.json(
      { message: "Konsinyasi berhasil dibuat", data: await serializeOrder(order, { detail: true }) },
      { status: 201 }
    );
  } catch (err) {
    return handleConsignError(err, "create consignment error");
  }
}
