import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

// 4 tab utama di bottom nav Flutter (lib/features/dashboard/dashboard_screen.dart)
export const MENU_KEYS = ["kasir", "inventori", "laporan", "pengaturan"] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

export const ROLES: UserRole[] = ["OWNER", "MANAGER", "KASIR", "GUDANG", "AKUNTAN"];

// OWNER selalu full access; menu "pengaturan" tidak boleh dimatikan untuk role
// manapun (satu-satunya jalan logout ada di situ). Aturan ini di-enforce di sini
// supaya konsisten dipakai baik saat resolve (login) maupun saat update (PUT).
export function isLocked(role: UserRole, menuKey: string): boolean {
  return role === "OWNER" || menuKey === "pengaturan";
}

export async function resolveMenuAccess(tenantId: string, role: UserRole): Promise<string[]> {
  if (role === "OWNER") return [...MENU_KEYS];

  const overrides = await prisma.roleMenuPermission.findMany({
    where: { tenantId, role },
  });
  const overrideMap = new Map(overrides.map((o) => [o.menuKey, o.canAccess]));

  return MENU_KEYS.filter((key) => {
    if (isLocked(role, key)) return true;
    return overrideMap.get(key) ?? true;
  });
}

export async function resolvePermissionMatrix(tenantId: string) {
  const overrides = await prisma.roleMenuPermission.findMany({ where: { tenantId } });
  const overrideMap = new Map(overrides.map((o) => [`${o.role}:${o.menuKey}`, o.canAccess]));

  return ROLES.map((role) => ({
    role,
    menus: MENU_KEYS.map((menuKey) => ({
      menuKey,
      canAccess: isLocked(role, menuKey) ? true : overrideMap.get(`${role}:${menuKey}`) ?? true,
      locked: isLocked(role, menuKey),
    })),
  }));
}
