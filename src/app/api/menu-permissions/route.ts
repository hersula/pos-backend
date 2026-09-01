import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, requireRole, AuthError } from "@/lib/auth";
import { MENU_KEYS, ROLES, isLocked, resolvePermissionMatrix } from "@/lib/menu-permissions";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER"]);

    const matrix = await resolvePermissionMatrix(user.tenantId);
    return NextResponse.json({ data: matrix });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("get menu-permissions error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}

const updateSchema = z.object({
  updates: z.array(
    z.object({
      role: z.enum(ROLES as [string, ...string[]]),
      menuKey: z.enum(MENU_KEYS),
      canAccess: z.boolean(),
    })
  ),
});

export async function PUT(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);
    requireRole(user, ["OWNER"]);

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Data tidak valid" }, { status: 400 });
    }

    const editable = parsed.data.updates.filter((u) => !isLocked(u.role as never, u.menuKey));

    await prisma.$transaction(
      editable.map((u) =>
        prisma.roleMenuPermission.upsert({
          where: { tenantId_role_menuKey: { tenantId: user.tenantId, role: u.role as never, menuKey: u.menuKey } },
          update: { canAccess: u.canAccess },
          create: { tenantId: user.tenantId, role: u.role as never, menuKey: u.menuKey, canAccess: u.canAccess },
        })
      )
    );

    const matrix = await resolvePermissionMatrix(user.tenantId);
    return NextResponse.json({ message: "Otoritas menu berhasil disimpan", data: matrix });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("update menu-permissions error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
