import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest } from "@/lib/auth";
import { handleOpnameError, loadOpnameOrThrow, serializeOpname } from "@/lib/stock-opname";

// GET — detail sesi + item (semua role tenant)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getTenantUserFromRequest(req);
    const opname = await loadOpnameOrThrow(prisma, user.tenantId, params.id);
    return NextResponse.json({ data: await serializeOpname(prisma, opname, true) });
  } catch (err) {
    return handleOpnameError(err, "get stock opname error");
  }
}
