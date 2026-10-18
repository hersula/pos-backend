import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole } from "@/lib/auth";
import { assertDraft, cancelSchema, handleOpnameError, loadOpnameOrThrow, lockOpname, parseBody, serializeOpname } from "@/lib/stock-opname";

// POST — batalkan sesi DRAFT (stok tidak berubah). OWNER, MANAGER.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER", "MANAGER"]);
    const body = await parseBody(req, cancelSchema);

    await prisma.$transaction(async (tx) => {
      await lockOpname(tx, user.tenantId, params.id);
      const opname = await loadOpnameOrThrow(tx, user.tenantId, params.id);
      assertDraft(opname, "dibatalkan");
      await tx.stockOpname.update({ where: { id: opname.id }, data: { status: "CANCELLED", cancelReason: body.reason } });
    });

    const opname = await loadOpnameOrThrow(prisma, user.tenantId, params.id);
    return NextResponse.json({ message: "Sesi opname dibatalkan", data: await serializeOpname(prisma, opname, true) });
  } catch (err) {
    return handleOpnameError(err, "cancel stock opname error");
  }
}
